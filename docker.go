package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
)

const (
	labelKind = "homelab-world.kind"
	labelHide = "homelab-world.hide"
)

// Minimal Docker Engine API client over the unix socket. Stdlib only.
type dockerClient struct {
	http *http.Client
}

func newDockerClient(sock string) *dockerClient {
	return &dockerClient{http: &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", sock)
		},
	}}}
}

func (d *dockerClient) get(ctx context.Context, path string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker"+path, nil)
	if err != nil {
		return err
	}
	resp, err := d.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("docker %s: %s", path, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

type apiContainer struct {
	ID     string            `json:"Id"`
	Names  []string          `json:"Names"`
	Image  string            `json:"Image"`
	State  string            `json:"State"`
	Status string            `json:"Status"`
	Labels map[string]string `json:"Labels"`
}

type apiStats struct {
	CPU struct {
		Usage struct {
			Total uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		System uint64 `json:"system_cpu_usage"`
		Online int    `json:"online_cpus"`
	} `json:"cpu_stats"`
	Memory struct {
		Usage uint64            `json:"usage"`
		Stats map[string]uint64 `json:"stats"`
	} `json:"memory_stats"`
	Networks map[string]struct {
		Rx uint64 `json:"rx_bytes"`
		Tx uint64 `json:"tx_bytes"`
	} `json:"networks"`
}

type Container struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Image   string  `json:"image"`
	Project string  `json:"project"`
	State   string  `json:"state"`  // running, exited, restarting, paused, created
	Health  string  `json:"health"` // healthy, unhealthy, starting, or ""
	Status  string  `json:"status"` // human readable, e.g. "Up 2 hours (healthy)"
	Kind    string  `json:"kind,omitempty"`
	CPU     float64 `json:"cpu"`   // percent, 100 = one full core
	Mem     uint64  `json:"mem"`   // bytes
	NetRx   float64 `json:"netRx"` // bytes/sec
	NetTx   float64 `json:"netTx"` // bytes/sec
}

type sample struct {
	cpu, sys uint64
	rx, tx   uint64
	at       time.Time
}

// collector turns point-in-time docker stats into rates by remembering the previous sample.
type collector struct {
	docker *dockerClient
	mu     sync.Mutex
	prev   map[string]sample
}

func (c *collector) collect(ctx context.Context) ([]Container, error) {
	var list []apiContainer
	if err := c.docker.get(ctx, "/containers/json?all=1", &list); err != nil {
		return nil, err
	}

	list = slices.DeleteFunc(list, func(ac apiContainer) bool {
		return strings.EqualFold(ac.Labels[labelHide], "true")
	})
	out := make([]Container, len(list))
	var wg sync.WaitGroup
	for i, ac := range list {
		out[i] = Container{
			Kind:    strings.ToLower(strings.TrimSpace(ac.Labels[labelKind])),
			ID:      ac.ID[:12],
			Name:    strings.TrimPrefix(firstOr(ac.Names, ac.ID[:12]), "/"),
			Image:   ac.Image,
			Project: ac.Labels["com.docker.compose.project"],
			State:   ac.State,
			Health:  parseHealth(ac.Status),
			Status:  ac.Status,
		}
		if ac.State != "running" {
			continue
		}
		wg.Add(1)
		go func(c2 *Container, id string) {
			defer wg.Done()
			c.fillStats(ctx, c2, id)
		}(&out[i], ac.ID)
	}
	wg.Wait()
	return out, nil
}

func (c *collector) fillStats(ctx context.Context, ct *Container, id string) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var s apiStats
	if err := c.docker.get(ctx, "/containers/"+id+"/stats?stream=false&one-shot=true", &s); err != nil {
		return
	}

	cur := sample{cpu: s.CPU.Usage.Total, sys: s.CPU.System, at: time.Now()}
	for _, n := range s.Networks {
		cur.rx += n.Rx
		cur.tx += n.Tx
	}
	ct.Mem = s.Memory.Usage - s.Memory.Stats["inactive_file"]
	if s.Memory.Stats["inactive_file"] > s.Memory.Usage {
		ct.Mem = s.Memory.Usage
	}

	c.mu.Lock()
	prev, ok := c.prev[id]
	c.prev[id] = cur
	c.mu.Unlock()
	if !ok {
		return
	}

	if cur.sys > prev.sys && cur.cpu >= prev.cpu {
		cpus := float64(max(s.CPU.Online, 1))
		ct.CPU = float64(cur.cpu-prev.cpu) / float64(cur.sys-prev.sys) * cpus * 100
	}
	if dt := cur.at.Sub(prev.at).Seconds(); dt > 0 && cur.rx >= prev.rx && cur.tx >= prev.tx {
		ct.NetRx = float64(cur.rx-prev.rx) / dt
		ct.NetTx = float64(cur.tx-prev.tx) / dt
	}
}

type DockerEvent struct {
	Time    int64  `json:"time"`
	Action  string `json:"action"`
	Name    string `json:"name"`
	Project string `json:"project"`
}

// watchEvents streams container lifecycle events until ctx is done, reconnecting on errors.
func (d *dockerClient) watchEvents(ctx context.Context, emit func(DockerEvent)) {
	filters := url.QueryEscape(`{"type":["container"]}`)
	for ctx.Err() == nil {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker/events?filters="+filters, nil)
		resp, err := d.http.Do(req)
		if err == nil {
			dec := json.NewDecoder(resp.Body)
			for {
				var e struct {
					Action string `json:"Action"`
					Time   int64  `json:"time"`
					Actor  struct {
						Attributes map[string]string `json:"Attributes"`
					} `json:"Actor"`
				}
				if dec.Decode(&e) != nil {
					break
				}
				if strings.EqualFold(e.Actor.Attributes[labelHide], "true") {
					continue
				}
				action := e.Action
				if strings.HasPrefix(action, "health_status") {
					action = strings.TrimSpace(strings.TrimPrefix(action, "health_status:"))
				}
				switch action {
				case "start", "die", "restart", "oom", "healthy", "unhealthy", "pause", "unpause":
					emit(DockerEvent{
						Time:    e.Time,
						Action:  action,
						Name:    e.Actor.Attributes["name"],
						Project: e.Actor.Attributes["com.docker.compose.project"],
					})
				}
			}
			resp.Body.Close()
		}
		select {
		case <-ctx.Done():
		case <-time.After(3 * time.Second):
		}
	}
}

func parseHealth(status string) string {
	switch {
	case strings.Contains(status, "(healthy)"):
		return "healthy"
	case strings.Contains(status, "(unhealthy)"):
		return "unhealthy"
	case strings.Contains(status, "(health: starting)"):
		return "starting"
	}
	return ""
}

func firstOr(s []string, def string) string {
	if len(s) > 0 {
		return s[0]
	}
	return def
}
