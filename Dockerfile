# Use the Apify base image for Node.js Playwright Firefox
FROM apify/actor-node-playwright-firefox:22

# Copy package.json and package-lock.json first
COPY package*.json ./

# Install npm dependencies
RUN npm install --quiet --omit=dev

# Copy the rest of the source code
COPY . .

# Download the Camoufox browser binary
RUN npx camoufox-js fetch

# Specify the launch command
CMD ["npm", "start"]
