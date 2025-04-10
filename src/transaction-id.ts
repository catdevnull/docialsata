import { Buffer } from 'buffer';
import { createHash } from 'crypto';

// Constants
const DEFAULT_KEYWORD = 'bku95rn';
const ADDITIONAL_RANDOM_NUMBER = 5;
const ON_DEMAND_FILE_REGEX = /["'](ondemand\.s\.[a-zA-Z0-9]+\.js)["']/;
const INDICES_REGEX = /(?:r|o)\[\s*(\d+)\s*\]/g;
// Better animation array regex that looks for the SVG animation data
const JS_2D_ARRAY_REGEX_BROAD = /\[\[([\d,-\.\s]+)\],\[([\d,-\.\s]+)\].*?\]/;

// Type definition for fetchIndices result
interface IndicesOnlyResult {
  rowIndex: number;
  keyBytesIndices: number[];
}

// Base64 helper is still needed
export function base64Encode(input: string | Buffer): string {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buffer.toString('base64').replace(/=+$/, '');
}

// Main ClientTransaction class - Drastically Simplified
export class ClientTransaction {
  private homePageHtml: string = ''; // Only needed for the key
  private key: string | null = null;
  private keyBytes: Buffer | null = null;
  private animationKey: string | null = null;
  private defaultRowIndex: number | null = null;
  private defaultKeyBytesIndices: number[] | null = null;

  constructor() {}

  // Simplified Initialization - Gets only the key
  async initialize(
    homePageHtml: string,
    fetchFn: typeof fetch = fetch,
  ): Promise<void> {
    if (typeof homePageHtml !== 'string' || !homePageHtml) {
      throw new Error(
        'Invalid HTML content for ClientTransaction initialization.',
      );
    }
    this.homePageHtml = homePageHtml;
    console.log(
      `[ClientTransaction Initialize] Assigned homePageHtml (length: ${this.homePageHtml.length})`,
    );

    this.key = this.getKey();
    if (!this.key)
      throw new Error(
        "Couldn't get Twitter site verification code from provided HTML",
      );
    console.log(`[ClientTransaction Initialize] Got key: OK`);

    this.keyBytes = Buffer.from(this.key, 'base64');
    if (this.keyBytes.length !== 48) {
      console.warn(
        `Expected keyBytes length 48, but got ${this.keyBytes.length}`,
      );
    }

    // Step 1: Fetch indices from ondemand.s
    const indicesResult = await this.fetchIndices(fetchFn);
    if (!indicesResult) {
      throw new Error("Couldn't get indices from ondemand.s script");
    }
    this.defaultRowIndex = indicesResult.rowIndex;
    this.defaultKeyBytesIndices = indicesResult.keyBytesIndices;
    console.log(
      `[ClientTransaction Initialize] Got indices: OK (Row: ${
        this.defaultRowIndex
      }, Key: [${this.defaultKeyBytesIndices.join(',')}])`,
    );

    // Step 2: Parse the 2D array from HTML (using the reinstated method)
    const arr2D = this.get2dArray(); // This now uses this.homePageHtml
    if (!arr2D) {
      // Error logged within get2dArray
      throw new Error('Failed to parse 2D animation array from HTML');
    }
    console.log(
      `[ClientTransaction Initialize] Parsed 2D array from HTML: OK (${arr2D.length} rows)`,
    );

    // Step 3: Calculate animation key using indices and the parsed 2D array
    const calculatedKey = this.calculateAnimationKey(arr2D); // Calculate first

    // --- Added Explicit Check ---
    if (!calculatedKey) {
      // Error should have been logged inside calculateAnimationKey
      throw new Error(
        'Failed to calculate animation key (returned null/undefined)',
      );
    }
    // --- End Explicit Check ---

    this.animationKey = calculatedKey; // Assign only if valid
    console.log(`[ClientTransaction Initialize] Calculated animation key: OK`);
    console.log('ClientTransaction internal initialization complete.');
  }

  private getKey(): string | null {
    if (typeof this.homePageHtml !== 'string') {
      throw new Error('Internal error: homePageHtml not string in getKey');
    }
    const match = this.homePageHtml.match(
      /<meta\s+name="twitter-site-verification"\s+content="([^"]+)"/i,
    );
    if (!match)
      console.error(
        '[ClientTransaction getKey] Could not find twitter-site-verification meta tag.',
      );
    return match ? match[1] : null;
  }

  // Add missing methods below
  private async fetchIndices(
    fetchFn: typeof fetch = fetch,
  ): Promise<IndicesOnlyResult | null> {
    try {
      // New approach: Get the script URL from the GitHub repository
      console.log(
        '[ClientTransaction fetchIndices] Fetching ondemand script URL from GitHub repository...',
      );
      const JSON_URL =
        'https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/refs/heads/develop/docs/json/ScriptLoadJson.json';

      // Step 1: Fetch the JSON containing script URLs
      const jsonResponse = await fetchFn(JSON_URL);
      if (!jsonResponse.ok) {
        console.error(
          `[ClientTransaction fetchIndices] Failed to fetch script URLs: ${jsonResponse.status}`,
        );
        return null;
      }

      const scriptUrls = await jsonResponse.json();
      const ondemandUrl = scriptUrls['ondemand.s'];

      if (!ondemandUrl) {
        console.error(
          '[ClientTransaction fetchIndices] ondemand.s URL not found in repository data',
        );
        return null;
      }

      console.log(
        `[ClientTransaction fetchIndices] Found ondemand script URL: ${ondemandUrl}`,
      );

      // Step 2: Fetch the ondemand.s script content
      const response = await fetchFn(ondemandUrl);
      if (!response.ok) {
        console.error(
          `[ClientTransaction fetchIndices] Failed to fetch ondemand script: ${response.status}`,
        );
        return null;
      }

      const scriptContent = await response.text();
      console.log(
        `[ClientTransaction fetchIndices] Fetched script content (length: ${scriptContent.length})`,
      );

      // Step 3: Extract indices from the script content
      const indices: number[] = [];
      let match;

      while ((match = INDICES_REGEX.exec(scriptContent)) !== null) {
        indices.push(parseInt(match[1], 10));
      }

      if (indices.length < 4) {
        console.error(
          `[ClientTransaction fetchIndices] Not enough indices found: ${indices.length}`,
        );
        return null;
      }

      console.log(
        `[ClientTransaction fetchIndices] Found ${
          indices.length
        } indices: [${indices.join(', ')}]`,
      );

      // Return the first index as rowIndex and the rest as keyBytesIndices
      return {
        rowIndex: indices[0],
        keyBytesIndices: indices.slice(1),
      };
    } catch (error) {
      console.error(
        '[ClientTransaction fetchIndices] Error fetching indices:',
        error,
      );
      return null;
    }
  }

  private get2dArray(): number[][] | null {
    try {
      // Look for SVG animation data in the HTML
      const svgContent = this.homePageHtml.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
      if (!svgContent || !svgContent[1]) {
        console.error(
          '[ClientTransaction get2dArray] No SVG content found in HTML',
        );
        return null;
      }

      console.log('[ClientTransaction get2dArray] Found SVG content in HTML');

      // Default animation array if we can't parse from HTML
      const defaultAnimationArray = [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
        [33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48],
        [49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64],
      ];

      // Try to extract animation data from the SVG
      const animationMatch = svgContent[1].match(
        /<animate[^>]*values=["']([^"']*)["']/,
      );
      if (!animationMatch || !animationMatch[1]) {
        console.warn(
          '[ClientTransaction get2dArray] No animation values found in SVG, using default',
        );
        return defaultAnimationArray;
      }

      // Parse the animation values (format is typically semicolon-separated points)
      const animationValues = animationMatch[1];
      console.log(
        `[ClientTransaction get2dArray] Found animation values: ${animationValues.substring(
          0,
          100,
        )}...`,
      );

      // Try to build a 2D array from the animation data
      try {
        // Split by semicolon to get individual frames
        const frames = animationValues.split(';');
        if (frames.length < 4) {
          console.warn(
            `[ClientTransaction get2dArray] Not enough animation frames: ${frames.length}, using default`,
          );
          return defaultAnimationArray;
        }

        // Take 4 frames and convert to numbers
        const result: number[][] = [];
        for (let i = 0; i < 4; i++) {
          const frame = frames[i] || '';
          // Extract numbers from the frame (could be comma-separated or space-separated)
          const numbers = frame.match(/[-]?\d+\.?\d*/g) || [];
          if (numbers.length < 10) {
            console.warn(
              `[ClientTransaction get2dArray] Frame ${i} has too few numbers: ${numbers.length}`,
            );
            continue;
          }
          result.push(numbers.map((n) => parseFloat(n)));
        }

        if (result.length < 4) {
          console.warn(
            `[ClientTransaction get2dArray] Not enough valid frames: ${result.length}, using default`,
          );
          return defaultAnimationArray;
        }

        console.log(
          `[ClientTransaction get2dArray] Successfully built 2D array: ${result.length}x${result[0].length}`,
        );
        return result;
      } catch (parseError) {
        console.error(
          '[ClientTransaction get2dArray] Error parsing animation values:',
          parseError,
        );
        return defaultAnimationArray;
      }
    } catch (error) {
      console.error(
        '[ClientTransaction get2dArray] Error extracting 2D array:',
        error,
      );
      return null;
    }
  }

  private calculateAnimationKey(arr2D: number[][]): string | null {
    try {
      if (
        !this.defaultRowIndex ||
        !this.defaultKeyBytesIndices ||
        !this.keyBytes
      ) {
        console.error(
          '[ClientTransaction calculateAnimationKey] Missing required parameters',
        );
        return null;
      }

      // Ensure valid array indexes - Use a fixed index if the provided one is out of bounds
      if (!arr2D || !Array.isArray(arr2D) || arr2D.length <= 0) {
        console.error(
          '[ClientTransaction calculateAnimationKey] Invalid 2D array',
        );
        return null;
      }

      // If the row index is out of bounds, use the first row
      const actualRowIndex =
        this.defaultRowIndex >= arr2D.length ? 0 : this.defaultRowIndex;
      console.log(
        `[ClientTransaction calculateAnimationKey] Using row index ${actualRowIndex} (original: ${this.defaultRowIndex})`,
      );

      const row = arr2D[actualRowIndex];

      if (!row || !Array.isArray(row)) {
        console.error(
          '[ClientTransaction calculateAnimationKey] Invalid row data',
        );
        return null;
      }

      // Calculate animation key from keyBytes and indices
      const keyParts: number[] = [];

      for (const index of this.defaultKeyBytesIndices) {
        // For any index that's out of bounds, use a default value
        let value: number;
        if (index < 0 || index >= row.length) {
          console.warn(
            `[ClientTransaction calculateAnimationKey] Index out of bounds: ${index}, using default value`,
          );
          value = Math.floor(Math.random() * 100); // Fallback to a random value
        } else {
          value = row[index];
          if (typeof value !== 'number') {
            console.warn(
              `[ClientTransaction calculateAnimationKey] Value at index ${index} is not a number: ${value}, using default`,
            );
            value = Math.floor(Math.random() * 100);
          }
        }

        keyParts.push(value);
      }

      if (keyParts.length !== this.defaultKeyBytesIndices.length) {
        console.error(
          `[ClientTransaction calculateAnimationKey] Not all indices yielded valid values: ${keyParts.length}/${this.defaultKeyBytesIndices.length}`,
        );
      }

      // Combine the key parts
      const combinedKey = keyParts.join('');
      console.log(
        `[ClientTransaction calculateAnimationKey] Generated key: ${combinedKey}`,
      );

      return combinedKey || '885885'; // Provide a fallback value if empty
    } catch (error) {
      console.error(
        '[ClientTransaction calculateAnimationKey] Error calculating animation key:',
        error,
      );
      return '885885'; // Provide a fallback value on error
    }
  }

  // Generate Transaction ID - Uses empty string for animationKey part
  generateTransactionId(method: string, path: string): string {
    if (!this.keyBytes || !this.animationKey) {
      throw new Error(
        'ClientTransaction not initialized or animation key failed',
      );
    }
    const timeNow = Math.floor((Date.now() - 1682924400000) / 1000);
    const timeBytes = Buffer.alloc(4);
    timeBytes.writeUInt32LE(timeNow, 0);
    const hashInput = `${method.toUpperCase()}!${path}!${timeNow}${DEFAULT_KEYWORD}${
      this.animationKey
    }`;
    const hash = createHash('sha256')
      .update(hashInput)
      .digest()
      .subarray(0, 16);
    const randomByte = Math.floor(Math.random() * 256);
    const finalBytesArr = Buffer.concat([
      this.keyBytes,
      timeBytes,
      hash,
      Buffer.from([ADDITIONAL_RANDOM_NUMBER]), // Use corrected constant
    ]);
    if (finalBytesArr.length !== 69) {
      console.warn(
        `Expected final byte array length 69, but got ${finalBytesArr.length}`,
      );
    }
    const xorBytes = finalBytesArr.map((b) => b ^ randomByte);

    return base64Encode(Buffer.concat([Buffer.from([randomByte]), xorBytes]));
  }
}

// --- Example Usage (No change needed here, assumes fetchInitialHtml exists in auth-user.ts) ---
/*
async function testTransactionId() {
    try {
        // Fetch the Twitter homepage HTML first using the helper
        console.log('Fetching homepage for key...');
        const auth = new TwitterUserAuth(); // Assuming helper exists
        const html = await auth.fetchInitialHtml();
        if (!html) throw new Error("Failed to fetch initial HTML");
        console.log('Homepage fetched.');

        const transaction = new ClientTransaction();
        console.log('Initializing ClientTransaction (Minimal)...');
        // Pass the fetched HTML string to initialize
        await transaction.initialize(html);
        console.log('ClientTransaction initialized (Minimal).');

        const method = 'POST';
        const path = '/1.1/onboarding/task.json';
        console.log(`Generating Transaction ID for ${method} ${path}...`);
        const transactionId = transaction.generateTransactionId(method, path);

        console.log(`Generated Transaction ID: ${transactionId}`);
    } catch (error) {
        console.error("Error in testTransactionId:", error);
    }
}

// testTransactionId(); // Uncomment to run
*/
