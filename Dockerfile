# Use the Apify base image for Node.js Playwright Firefox
FROM apify/actor-node-playwright-firefox:22

# Copy package.json and package-lock.json first
COPY --chown=myuser:myuser package*.json ./

# Install all npm dependencies (force include devDependencies for compiling TypeScript)
RUN npm install --quiet --include=dev

# Copy the rest of the source code
COPY --chown=myuser:myuser . ./

# Compile TypeScript to dist/
RUN npm run build

# Prune devDependencies to keep the image size small
RUN npm prune --omit=dev

# Download the Camoufox browser binary
RUN npx camoufox-js fetch

# Specify the launch command
CMD ["npm", "start"]
