FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY prompts ./prompts

ENV NODE_ENV=production
ENV LLM_SERVICE_PORT=8012

EXPOSE 8012

CMD ["npm", "start"]
