SHELL := /usr/bin/env bash
.PHONY: test release-check test-install test-clean

test: test-install
	npm test --prefix test

release-check: test
	node test/validate-release.js

test-install:
	npm ci --prefix test --loglevel=error

test-clean:
	rm -rf test/node_modules
