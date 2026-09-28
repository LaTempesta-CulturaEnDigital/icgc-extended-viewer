FROM node:22.12.0-bookworm-slim
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Build/export tool, not a production web server. Mount a destination at /output.
# Local Compose overrides this command to run Vite preview.
CMD ["sh", "-c", "mkdir -p /output && cp -R /build/dist/. /output/"]
