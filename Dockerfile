# Stage 1: Build the project
FROM apify/actor-node-playwright-firefox:22 AS builder

# Copy package files and install all dependencies (including devDependencies)
COPY --chown=myuser:myuser package*.json ./
RUN npm install --quiet --include=dev

# Copy the rest of the source code and build
COPY --chown=myuser:myuser . ./
RUN npm run build

# Stage 2: Create the final production image
FROM apify/actor-node-playwright-firefox:22

# Set Camoufox installation directory
ENV CAMOUFOX_INSTALL_DIR=/home/myuser/camoufox-cache

# Copy only the compiled output from the builder stage
COPY --from=builder --chown=myuser:myuser /home/myuser/dist ./dist

# Copy package files again to install only production dependencies
COPY --chown=myuser:myuser package*.json ./
RUN npm install --quiet --omit=dev

# Download the Camoufox browser binary
RUN npx camoufox-js fetch

# Run the project using the compiled JavaScript output
CMD ["node", "dist/main.js"]
