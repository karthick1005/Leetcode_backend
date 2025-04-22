
# FROM alpine:3.14

# # Install basic packages
# RUN apk update && \
#     apk add --no-cache curl vim sudo build-base python3 py3-pip && \
#     apk add --no-cache nodejs npm 

# # Install Python 2 for 'python' command and Python 3
# RUN apk add --no-cache python2 && \
#     ln -sf python3 /usr/bin/python  
# # Create a symlink to ensure 'python' points to 'python3'
# RUN apk add --no-cache openjdk11-jdk bash

# # RUN sudo apk add mcr.microsoft.com/dotnet/sdk:6.0
# # RUN apk add dotnet6-sdk
# #RUN dotnet --version

# # Check versions
# RUN node -v
# RUN npm -v
# RUN javac -version
# RUN python --version
# RUN python3 --version

# # Install TypeScript globally
# RUN npm install -g typescript

# # Copy all project files
# COPY . .

# # Create and set permissions for the temp directory
# RUN mkdir temp && \
#     chmod 700 / && \
#     chmod 755 -R temp/

# # Add user without a password
# RUN adduser -D judge

# # Navigate to app folder and install npm dependencies
# WORKDIR /app
# RUN npm install

# # Command to start the app
# CMD ["npm", "start"]
FROM alpine:3.17

# Install basic packages
RUN apk update && \
    apk add --no-cache curl vim sudo build-base python3 py3-pip && \
    apk add --no-cache nodejs npm 

RUN apk add --no-cache build-base wget
RUN apk add coreutils
# Download Python 2 source
RUN wget https://www.python.org/ftp/python/2.7.18/Python-2.7.18.tgz && \
    tar -xzf Python-2.7.18.tgz && \
    cd Python-2.7.18 && \
    ./configure && \
    make && \
    make install && \
    cd .. && \
    rm -rf Python-2.7.18 Python-2.7.18.tgz

# Verify Python 2 installation
RUN python2 --version
# Create a symlink to ensure 'python' points to 'python3'
RUN apk add --no-cache openjdk11-jdk bash

# Install .NET SDK 6.0 (Alpine 3.20 should have support for dotnet6-sdk in the community repository)
# RUN apk add --no-cache dotnet6-sdk
RUN apk add --no-cache \
    dotnet6-sdk \
    bash \
    libc6-compat

RUN dotnet --version
# Check versions
RUN node -v
RUN npm -v
RUN javac -version
# RUN python --version
RUN python3 --version

# Install TypeScript globally
RUN npm install -g typescript

# Copy all project files
COPY . .

# Create and set permissions for the temp directory
RUN mkdir temp && \
    chmod 700 / && \
    chmod 755 -R temp/

# Add user without a password
RUN adduser -D judge

# Navigate to app folder and install npm dependencies
WORKDIR /app
RUN npm install

# Command to start the app
CMD ["npm", "start"]
