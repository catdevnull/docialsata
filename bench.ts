import { argv } from 'process';
import PQueue from 'p-queue';
// Available endpoints to test
const ENDPOINTS = {
  'search-people': 'Search people endpoint',
  'search-tweets': 'Search tweets endpoint',
  profile: 'User profile endpoint',
  'tweets-replies': 'Tweets and replies endpoint',
  following: 'Following list endpoint',
  followers: 'Followers list endpoint',
} as const;

type EndpointKey = keyof typeof ENDPOINTS;

// Sample test data
const TEST_USERS = [
  'elonmusk',
  'BillGates',
  'BarackObama',
  'taylorswift13',
  'NASA',
];

const TEST_SEARCH_QUERIES = [
  'artificial intelligence',
  'climate change',
  'space exploration',
  'technology news',
  'blockchain',
];

interface BenchmarkResult {
  endpoint: string;
  iterations: number;
  totalTimeMs: number;
  averageTimeMs: number;
  errors: number;
}

function getRandomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

async function runBenchmark(
  name: string,
  iterations: number,
  fn: () => Promise<Response>,
): Promise<BenchmarkResult> {
  console.log(`Running benchmark: ${name}`);
  let errors = 0;
  const startTime = performance.now();

  const queue = new PQueue({ concurrency: 1000 });

  for (let i = 0; i < iterations; i++) {
    queue.add(async () => {
      try {
        const response = await fn();
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        process.stdout.write('.');
      } catch (error) {
        errors++;
        process.stdout.write('x');
        console.error('\nError:', error);
      }
    });
  }

  await queue.onIdle();

  const endTime = performance.now();
  const totalTimeMs = endTime - startTime;
  console.log('\n');

  return {
    endpoint: name,
    iterations,
    totalTimeMs,
    averageTimeMs: totalTimeMs / iterations,
    errors,
  };
}

async function testEndpoint(
  endpoint: EndpointKey,
  iterations: number,
  token: string,
) {
  const baseUrl = 'http://localhost:3000/api';

  const endpointTests: Record<EndpointKey, () => Promise<Response>> = {
    'search-people': () => {
      const query = encodeURIComponent(getRandomItem(TEST_SEARCH_QUERIES));
      return fetch(`${baseUrl}/search/people/${query}?until=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    'search-tweets': () => {
      const query = encodeURIComponent(getRandomItem(TEST_SEARCH_QUERIES));
      return fetch(`${baseUrl}/search/tweets/${query}?until=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    profile: () => {
      const user = getRandomItem(TEST_USERS);
      return fetch(`${baseUrl}/users/@${user}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    'tweets-replies': () => {
      const user = getRandomItem(TEST_USERS);
      return fetch(`${baseUrl}/users/@${user}/tweets-and-replies?until=40`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    following: () => {
      const user = getRandomItem(TEST_USERS);
      return fetch(`${baseUrl}/users/@${user}/following?until=40`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    followers: () => {
      const user = getRandomItem(TEST_USERS);
      return fetch(`${baseUrl}/users/@${user}/followers?until=40`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
  };

  const testFn = endpointTests[endpoint];
  if (!testFn) {
    throw new Error(`Unknown endpoint: ${endpoint}`);
  }

  return await runBenchmark(ENDPOINTS[endpoint], iterations, testFn);
}

function printUsage() {
  console.log('\nUsage: bun bench.ts <endpoint> <iterations> <token>');
  console.log('\nAvailable endpoints:');
  Object.entries(ENDPOINTS).forEach(([key, desc]) => {
    console.log(`  ${key.padEnd(15)} ${desc}`);
  });
  console.log('\nExample: bun bench.ts search-tweets 5 your-token-here');
  process.exit(1);
}

async function main() {
  const [, , endpoint, iterationsStr, token] = argv;

  if (!endpoint || !iterationsStr || !token) {
    printUsage();
  }

  const iterations = parseInt(iterationsStr);
  if (isNaN(iterations) || iterations < 1) {
    console.error('Iterations must be a positive number');
    printUsage();
  }

  if (!(endpoint in ENDPOINTS)) {
    console.error('Invalid endpoint');
    printUsage();
  }

  console.log(`Testing endpoint: ${ENDPOINTS[endpoint as EndpointKey]}`);
  console.log(`Iterations: ${iterations}\n`);

  const result = await testEndpoint(endpoint as EndpointKey, iterations, token);

  console.log('\nBenchmark Results:');
  console.table({
    Endpoint: result.endpoint,
    Iterations: result.iterations,
    'Total Time (ms)': Math.round(result.totalTimeMs),
    'Avg Time (ms)': Math.round(result.averageTimeMs),
    Errors: result.errors,
  });
}

main().catch(console.error);
