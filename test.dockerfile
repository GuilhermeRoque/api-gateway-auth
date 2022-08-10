FROM node:16-alpine3.15
WORKDIR /root
COPY package*.json ./
COPY ./src ./src
RUN npm ci
EXPOSE 3000
CMD ["npm", "run", "start-dev"]