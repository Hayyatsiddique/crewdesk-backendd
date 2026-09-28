#!/bin/bash
set -e

sleep 20

curl --fail --silent http://127.0.0.1:5001/health | grep '"status":"ok"'
