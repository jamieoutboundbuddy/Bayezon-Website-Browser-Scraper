#!/bin/bash
export RAILWAY_TOKEN=f70af740-b9c6-4be3-8565-95335fc13d1c

echo "--- WHOAMI ---"
npx -y railway whoami

echo "--- LIST ---"
npx -y railway list

echo "--- STATUS ---"
npx -y railway status
