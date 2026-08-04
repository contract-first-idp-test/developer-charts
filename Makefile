SHELL := /usr/bin/env bash
.PHONY: test test-install test-clean

test: test-install
	npm test --prefix test

test-install:
	npm ci --prefix test

test-clean:
	rm -rf test/node_modules
