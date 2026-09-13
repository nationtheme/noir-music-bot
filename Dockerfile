FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /app/data /app/uploads
EXPOSE 3000
CMD ["node", "server.js"]

