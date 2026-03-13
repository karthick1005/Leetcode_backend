FROM node:16-alpine3.11
WORKDIR '/app'

COPY package.json .
RUN npm install
COPY . .

# Run with nodemon in development, regular npm start in production
CMD if [ "$NODE_ENV" = "development" ]; then npm run dev; else npm start; fi
