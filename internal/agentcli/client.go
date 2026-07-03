package agentcli

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const roastMetaHeader = "X-Roast-Meta"
const streamFramePrefix = "\x1f"
const githubAPI = "https://api.github.com"

type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

type Client struct {
	Host           string
	APIKey         string
	TurnstileToken string
	GitHubToken    string
	HTTP           HTTPDoer
}

type APIError struct {
	Status int
	Code   string
	Body   string
}

func (e APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("API request failed: %s", e.Code)
	}
	return fmt.Sprintf("API request failed with HTTP %d", e.Status)
}

type RoastResult struct {
	Meta     map[string]any `json:"meta"`
	Report   string         `json:"report"`
	Progress []string       `json:"progress"`
}

func NewClient(opts globalOptions) Client {
	return Client{
		Host:           strings.TrimRight(opts.Host, "/"),
		APIKey:         opts.APIKey,
		TurnstileToken: opts.TurnstileToken,
		GitHubToken:    opts.GitHubToken,
		HTTP:           &http.Client{Timeout: 180 * time.Second},
	}
}

func (c Client) Scan(ctx context.Context, username string) (map[string]any, error) {
	body := map[string]any{"username": username}
	if c.TurnstileToken != "" {
		body["turnstileToken"] = c.TurnstileToken
	}
	var result map[string]any
	if err := c.postJSON(ctx, "/api/scan", body, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func (c Client) Scored(ctx context.Context, username string) (map[string]any, error) {
	return c.getJSON(ctx, "/api/score/"+url.PathEscape(username), nil)
}

func (c Client) SearchUsers(ctx context.Context, q string) (map[string]any, error) {
	query := url.Values{}
	query.Set("q", q)
	return c.getJSON(ctx, "/api/search-users", query)
}

func (c Client) Vs(ctx context.Context, a string, b string) (map[string]any, error) {
	var result map[string]any
	if err := c.postJSON(ctx, "/api/vs-verdict", map[string]any{"a": a, "b": b}, &result); err != nil {
		return nil, err
	}
	return result, nil
}

// GitHubUser checks a login against GitHub's own public API, on the caller's
// IP/quota — never touching ghfind. Returns (profile, exists, error). A 404 is
// exists=false with no error; a rate-limit becomes an APIError so a throttle is
// never mistaken for "not found".
func (c Client) GitHubUser(ctx context.Context, username string) (map[string]any, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubAPI+"/users/"+url.PathEscape(username), nil)
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if c.GitHubToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.GitHubToken)
	}
	res, err := c.http().Do(req)
	if err != nil {
		return nil, false, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil, false, nil
	}
	if res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusTooManyRequests {
		return nil, false, APIError{Status: res.StatusCode, Code: "github_rate_limited"}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, false, readAPIError(res)
	}
	var user map[string]any
	if err := json.NewDecoder(res.Body).Decode(&user); err != nil {
		return nil, false, err
	}
	return user, true, nil
}

func (c Client) Roast(ctx context.Context, scan map[string]any, lang string, byoKey map[string]string) (RoastResult, error) {
	body := map[string]any{
		"scan": scan,
		"lang": lang,
	}
	if byoKey != nil {
		body["byoKey"] = byoKey
	}
	reqBody, err := json.Marshal(body)
	if err != nil {
		return RoastResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Host+"/api/roast", bytes.NewReader(reqBody))
	if err != nil {
		return RoastResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	res, err := c.http().Do(req)
	if err != nil {
		return RoastResult{}, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return RoastResult{}, readAPIError(res)
	}
	return parseRoastHTTPResponse(res)
}

func (c Client) Stats(ctx context.Context) (map[string]any, error) {
	return c.getJSON(ctx, "/api/stats", nil)
}

func (c Client) Leaderboard(ctx context.Context, view string, window string) (map[string]any, error) {
	query := url.Values{}
	if view != "" {
		query.Set("view", view)
	}
	if window != "" {
		query.Set("window", window)
	}
	return c.getJSON(ctx, "/api/leaderboard", query)
}

func (c Client) Developers(ctx context.Context, facetType string, value string) (map[string]any, error) {
	query := url.Values{}
	query.Set("type", facetType)
	if value != "" {
		query.Set("value", value)
	}
	return c.getJSON(ctx, "/api/developers", query)
}

func (c Client) getJSON(ctx context.Context, path string, query url.Values) (map[string]any, error) {
	reqURL := c.Host + path
	if len(query) > 0 {
		reqURL += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	res, err := c.http().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, readAPIError(res)
	}
	var out map[string]any
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c Client) postJSON(ctx context.Context, path string, body any, out any) error {
	reqBody, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Host+path, bytes.NewReader(reqBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	res, err := c.http().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return readAPIError(res)
	}
	return json.NewDecoder(res.Body).Decode(out)
}

func (c Client) http() HTTPDoer {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 180 * time.Second}
}

func readAPIError(res *http.Response) error {
	data, _ := io.ReadAll(res.Body)
	var payload map[string]any
	code := ""
	if json.Unmarshal(data, &payload) == nil {
		if value, ok := payload["error"].(string); ok {
			code = value
		}
	}
	return APIError{Status: res.StatusCode, Code: code, Body: string(data)}
}

func parseRoastHTTPResponse(res *http.Response) (RoastResult, error) {
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return RoastResult{}, err
	}
	result := RoastResult{
		Meta:     decodeMeta(res.Header.Get(roastMetaHeader)),
		Progress: []string{},
	}
	var report []string
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, streamFramePrefix+"T") {
			result.Progress = append(result.Progress, strings.TrimPrefix(line, streamFramePrefix+"T"))
			continue
		}
		if strings.HasPrefix(line, streamFramePrefix+"M") {
			if meta := decodeMeta(strings.TrimPrefix(line, streamFramePrefix+"M")); meta != nil {
				result.Meta = meta
			}
			continue
		}
		if strings.HasPrefix(line, streamFramePrefix+"E") {
			return RoastResult{}, APIError{
				Status: res.StatusCode,
				Code:   "roast_stream_failed",
				Body:   strings.TrimPrefix(line, streamFramePrefix+"E"),
			}
		}
		report = append(report, line)
	}
	result.Report = strings.TrimSpace(strings.Join(report, "\n"))
	return result, nil
}

func decodeMeta(raw string) map[string]any {
	if raw == "" {
		return nil
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil
	}
	var meta map[string]any
	if json.Unmarshal(data, &meta) != nil {
		return nil
	}
	return meta
}
