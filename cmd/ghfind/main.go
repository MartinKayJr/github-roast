package main

import (
	"os"

	"github.com/hikariming/ghfind/internal/agentcli"
)

func main() {
	os.Exit(agentcli.Execute(os.Args[1:], os.Stdout, os.Stderr))
}
