package main

import (
	"context"
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

//go:embed web
var embedded embed.FS

type Snapshot struct {
	Type       string       `json:"type"`
	Time       int64        `json:"time"`
	Containers []Container  `json:"containers"`
	Pihole     *PiholeStats `json:"pihole,omitempty"`
	Error      string       `json:"error,omitempty"`
}

// hub fans out messages to every connected SSE client and remembers the latest snapshot.
type hub struct {
	mu      sync.Mutex
	clients map[chan []byte]struct{}
	latest  []byte
}

func (h *hub) broadcast(msg []byte, isSnapshot bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if isSnapshot {
		h.latest = msg
	}
	for c := range h.clients {
		select {
		case c <- msg:
		default: // slow client, drop the frame
		}
	}
}

func (h *hub) subscribe() (chan []byte, []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c := make(chan []byte, 16)
	h.clients[c] = struct{}{}
	return c, h.latest
}

func (h *hub) unsubscribe(c chan []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
}

func (h *hub) serveSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	c, latest := h.subscribe()
	defer h.unsubscribe(c)
	write := func(msg []byte) {
		w.Write([]byte("data: "))
		w.Write(msg)
		w.Write([]byte("\n\n"))
		flusher.Flush()
	}
	if latest != nil {
		write(latest)
	}

	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-c:
			write(msg)
		case <-keepalive.C:
			w.Write([]byte(": ping\n\n"))
			flusher.Flush()
		}
	}
}

func main() {
	addr := env("ADDR", ":8099")
	host := os.Getenv("DOCKER_HOST")
	if host == "" {
		host = "unix://" + env("DOCKER_SOCK", "/var/run/docker.sock")
	}
	interval, err := time.ParseDuration(env("POLL_INTERVAL", "2s"))
	if err != nil {
		log.Fatalf("bad POLL_INTERVAL: %v", err)
	}

	docker, err := newDockerClient(host)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("docker: %s", host)
	col := &collector{docker: docker, prev: map[string]sample{}}
	h := &hub{clients: map[chan []byte]struct{}{}}

	var pihole *piholeClient
	if u := os.Getenv("PIHOLE_URL"); u != "" {
		pihole = newPiholeClient(u, os.Getenv("PIHOLE_PASSWORD"))
		log.Printf("pihole enabled: %s", u)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	poke := make(chan struct{}, 1)
	go docker.watchEvents(ctx, func(e DockerEvent) {
		msg, _ := json.Marshal(struct {
			Type string `json:"type"`
			DockerEvent
		}{"event", e})
		h.broadcast(msg, false)
		select {
		case poke <- struct{}{}:
		default:
		}
	})

	go func() {
		tick := time.NewTicker(interval)
		defer tick.Stop()
		piholeWarned := false
		lastErr := ""
		for {
			containers, err := col.collect(ctx)
			if err != nil {
				if err.Error() != lastErr {
					log.Printf("collect: %v", err)
					lastErr = err.Error()
				}
				msg, _ := json.Marshal(Snapshot{Type: "snapshot", Time: time.Now().UnixMilli(), Error: err.Error()})
				h.broadcast(msg, true)
			} else {
				lastErr = ""
				snap := Snapshot{Type: "snapshot", Time: time.Now().UnixMilli(), Containers: containers}
				if pihole != nil {
					if s, err := pihole.stats(ctx); err == nil {
						snap.Pihole = s
						piholeWarned = false
					} else if !piholeWarned {
						log.Printf("pihole: %v", err)
						piholeWarned = true
					}
				}
				msg, _ := json.Marshal(snap)
				h.broadcast(msg, true)
			}
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
			case <-poke:
			}
		}
	}()

	var web fs.FS
	if dir := os.Getenv("WEB_DIR"); dir != "" {
		web = os.DirFS(dir) // live-edit the frontend without rebuilding
	} else {
		web, _ = fs.Sub(embedded, "web")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/stream", h.serveSSE)
	mux.Handle("GET /", http.FileServerFS(web))

	srv := &http.Server{Addr: addr, Handler: mux}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	log.Printf("homelab-world listening on %s", addr)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
