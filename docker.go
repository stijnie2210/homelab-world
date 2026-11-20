package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
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

// Minimal Docker Engine API client over a unix socket or TCP (a socket proxy). Stdlib only.
type dockerClient struct {
	host    string
	base    string
	http    *http.Client
	mu      sync.Mutex
	version string
}

func newDockerClient(host string) (*dockerClient, error) {
	tr := &http.Transport{}
	base := "http://docker"
	switch {
	case strings.HasPrefix(host, "unix://"):
		sock := strings.TrimPrefix(host, "unix://")
		tr.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", sock)
		}
	case strings.HasPrefix(host, "tcp://"), strings.HasPrefix(host, "http://"):
		u, err := url.Parse(host)
		if err != nil || u.Host == "" {
			return nil, fmt.Errorf("bad DOCKER_HOST %q", host)
		}
		base = "http://" + u.Host
	default:
		return nil, fmt.Errorf("unsupported DOCKER_HOST %q: use unix:///path/to/docker.sock or tcp://host:port", host)
	}
	return &dockerClient{host: host, base: base, http: &http.Client{Transport: tr}}, nil
}

func (d *dockerClient) url(ctx context.Context, path string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.version == "" {
		d.version = d.ping(ctx)
	}
	if d.version == "" {
		return d.base + path
	}
	return d.base + "/v" + d.version + path
}

func (d *dockerClient) ping(ctx context.Context) string {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.base+"/_ping", nil)
	if err != nil {
		return ""
	}
	resp, err := d.http.Do(req)
	if err != nil {
		return ""
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	return resp.Header.Get("Api-Version")
}

func (d *dockerClient) get(ctx context.Context, path string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.url(ctx, path), nil)
	if err != nil {
		return err
	}
	resp, err := d.http.Do(req)
	if err != nil {
		return d.unreachable(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return apiError(req, resp)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

func apiError(req *http.Request, resp *http.Response) error {
	if resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("Docker refused GET %s (403 Forbidden). If you use a socket proxy, allow GET on _ping, containers/json, containers/{id}/stats and events", req.URL.Path)
	}
	return fmt.Errorf("Docker answered GET %s with %s", req.URL.Path, resp.Status)
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
	lastErr := ""
	report := func(err error) {
		msg := ""
		if err != nil {
			msg = err.Error()
		}
		if msg != lastErr && msg != "" {
			log.Printf("events: %s", msg)
		}
		lastErr = msg
	}
	for ctx.Err() == nil {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, d.url(ctx, "/events?filters="+filters), nil)
		resp, err := d.http.Do(req)
		switch {
		case err != nil:
			report(d.unreachable(err))
		case resp.StatusCode != http.StatusOK:
			report(apiError(req, resp))
			resp.Body.Close()
			err = errors.New(resp.Status)
		default:
			report(nil)
		}
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

func (d *dockerClient) unreachable(err error) error {
	if strings.HasPrefix(d.host, "unix://") {
		return fmt.Errorf("can't reach Docker at %s: %w", d.host, err)
	}
	return fmt.Errorf("can't reach Docker at %s. With the bundled socket proxy, docker logs homelab-world-socket-proxy says why; on Linux it usually needs DOCKER_GID in .env (see the README). Error: %w", d.host, err)
}
