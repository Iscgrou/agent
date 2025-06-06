#!/bin/bash

# Kill any processes using port 3000 and 8000
echo "Cleaning up ports..."
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:8000 | xargs kill -9 2>/dev/null

# Start backend server
echo "Starting backend server..."
cd backend
npm install
npm run dev &

# Wait for backend to start
echo "Waiting for backend to start..."
sleep 5

# Start frontend server
echo "Starting frontend server..."
cd ../frontend
python3 -m http.server 8000 &

echo "Servers started!"
echo "Backend running on http://localhost:3000"
echo "Frontend running on http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for Ctrl+C
trap "trap - SIGTERM && kill -- -$$" SIGINT SIGTERM EXIT
wait
