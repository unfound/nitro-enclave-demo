#!/bin/bash
export PATH="/home/sion/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"
cd /home/sion/.hermes/projects/nitro-enclave-demo/frontend
exec npx next dev -p 3000
