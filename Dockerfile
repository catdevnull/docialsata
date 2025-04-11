FROM oven/bun:1

RUN apt-get update && apt-get install -y \
    git \
    curl \
    build-essential \
    libssl-dev \
    zlib1g-dev \
    libbz2-dev \
    libreadline-dev \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Install pyenv and Python 3.13
RUN curl https://pyenv.run | bash && \
    echo 'export PATH="$HOME/.pyenv/bin:$PATH"' >> ~/.bashrc && \
    echo 'eval "$(pyenv init -)"' >> ~/.bashrc && \
    echo 'eval "$(pyenv virtualenv-init -)"' >> ~/.bashrc

ENV PATH="/root/.pyenv/bin:$PATH"
RUN eval "$(pyenv init -)" && \
    pyenv install 3.13.0 && \
    pyenv global 3.13.0 && \
    pip install --upgrade pip

WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install
COPY . .

RUN eval "$(pyenv init -)" && \
    pip install beautifulsoup4 lxml requests ./src/x-client-transaction-py/

EXPOSE 3000
# Update path for Python 3.13 library
ENV BUN_PYTHON_PATH="/root/.pyenv/versions/3.13.0/lib/libpython3.13.so"
CMD ["bun", "start"] 