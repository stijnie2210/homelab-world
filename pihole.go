package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Pi-hole v6 API client. Only reads query counters.
type piholeClient struct {
	base     string
	password string
	sid      string
	http     *http.Client
}

type PiholeStats struct {
	Total   int64 `json:"total"`
	Blocked int64 `json:"blocked"`
}

var errUnauthorized = errors.New("pihole: unauthorized")

func newPiholeClient(base, password string) *piholeClient {
	return &piholeClient{
		base:     strings.TrimRight(base, "/"),
		password: password,
		http:     &http.Client{Timeout: 3 * time.Second},
	}
}

func (p *piholeClient) stats(ctx context.Context) (*PiholeStats, error) {
	s, err := p.summary(ctx)
	if errors.Is(err, errUnauthorized) && p.password != "" {
		if err := p.login(ctx); err != nil {
			return nil, err
		}
		s, err = p.summary(ctx)
	}
	return s, err
}

func (p *piholeClient) summary(ctx context.Context) (*PiholeStats, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.base+"/api/stats/summary", nil)
	if err != nil {
		return nil, err
	}
	if p.sid != "" {
		req.Header.Set("X-FTL-SID", p.sid)
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, errUnauthorized
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("pihole summary: %s", resp.Status)
	}
	var body struct {
		Queries PiholeStats `json:"queries"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	return &body.Queries, nil
}

func (p *piholeClient) login(ctx context.Context) error {
	payload, _ := json.Marshal(map[string]string{"password": p.password})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.base+"/api/auth", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var body struct {
		Session struct {
			Valid bool   `json:"valid"`
			SID   string `json:"sid"`
		} `json:"session"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return err
	}
	if !body.Session.Valid {
		return fmt.Errorf("pihole login rejected (%s)", resp.Status)
	}
	p.sid = body.Session.SID
	return nil
}
