#!/bin/bash
export PATH="/home/sion/.local/share/fnm/node-versions/v24.14.0/installation/bin:/home/sion/.local/share/fnm:$PATH"
cd /home/sion/.hermes/projects/nitro-enclave-demo/frontend
exec ./node_modules/.bin/next dev --port 3000
