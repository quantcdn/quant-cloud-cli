import { Command } from 'commander';
import chalk from 'chalk';
import { chromium, Browser, Page } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { promises as fs } from 'fs';
import { join } from 'path';
import { createSpinner } from '../utils/spinner.js';
import { ApiClient } from '../utils/api.js';
import { Logger } from '../utils/logger.js';
import { loadVRTConfig, VRTConfig } from '../utils/config.js';

const logger = new Logger('VRT');

interface VRTOptions {
  project?: string;
  threshold?: string;
  maxPages?: string;
  maxDepth?: string;
  csv?: string;
  quantAuth?: string;
  remoteAuth?: string;
  outputDir?: string;
}

interface VRTResult {
  project: string;
  status: 'PASS' | 'FAIL' | 'ERROR';
  quantUrl: string;
  remoteUrl: string;
  differencePercentage: number;
  screenshot: string;
  timestamp: string;
  errorMessage?: string;
  pagePath?: string;
}

interface CrawledPage {
  url: string;
  path: string;
}

export function vrtCommand(program: Command) {
  const vrt = program
    .command('vrt')
    .description('Run visual regression testing against Quant projects')
    .option('--project <project>', 'specific project to test (comma-separated for multiple)')
    .option('--threshold <threshold>', 'pixel difference threshold (0-1)')
    .option('--max-pages <maxPages>', 'maximum pages to crawl per project')
    .option('--max-depth <maxDepth>', 'maximum crawl depth')
    .option('--csv <file>', 'output CSV report file')
    .option('--quant-auth <credentials>', 'basic auth for Quant URLs (user:pass)')
    .option('--remote-auth <credentials>', 'basic auth for remote URLs (user:pass)')
    .option('--output-dir <dir>', 'output directory for screenshots')
    .action(async (options: VRTOptions) => {
      await handleVRT(options);
    });

  return vrt;
}

async function handleVRT(options: VRTOptions) {
  try {
    // Load VRT configuration
    const config = await loadVRTConfig();
    if (!config || Object.keys(config.projects).length === 0) {
      logger.error('No VRT projects configured.');
      logger.info(`Configure projects by creating ${chalk.cyan('~/.quant/vrt-config.json')}`);
      logger.info('Example format:');
      logger.info(JSON.stringify({
        projects: {
          'my-project': 'https://example.com'
        },
        threshold: 0.01,
        maxPages: 10,
        maxDepth: 3
      }, null, 2));
      process.exit(1);
    }

    // Determine which projects to test
    const projectsToTest = options.project 
      ? options.project.split(',').map(p => p.trim())
      : Object.keys(config.projects);

    // Validate projects exist in config
    const invalidProjects = projectsToTest.filter(p => !config.projects[p]);
    if (invalidProjects.length > 0) {
      logger.error(`Invalid projects: ${invalidProjects.join(', ')}`);
      logger.info('Available projects:');
      Object.keys(config.projects).forEach(p => logger.info(`  - ${chalk.cyan(p)}`));
      process.exit(1);
    }

    // Parse options (CLI flags override config file)    
    const threshold = parseFloat(options.threshold || config.threshold?.toString() || '0.01');
    const maxPages = parseInt(options.maxPages || (config.maxPages !== undefined ? config.maxPages.toString() : '10'), 10);
    const maxDepth = parseInt(options.maxDepth || (config.maxDepth !== undefined ? config.maxDepth.toString() : '3'), 10);
    const outputDir = options.outputDir || './vrt-results';
    const quantAuth = options.quantAuth || config.quantAuth;
    const remoteAuth = options.remoteAuth || config.remoteAuth;

    logger.info(`Running VRT for ${projectsToTest.length} project(s)...`);
    logger.info(`Threshold: ${(threshold * 100).toFixed(2)}%, Max Pages: ${maxPages}, Max Depth: ${maxDepth}`);

    // Create API client
    const client = await ApiClient.create();

    // Run VRT for each project
    const allResults: VRTResult[] = [];
    let browser: Browser | null = null;

    try {
      browser = await chromium.launch({ headless: true });

      for (const projectName of projectsToTest) {
        const remoteUrl = config.projects[projectName];
        logger.info(`\n${chalk.bold(`Testing project: ${chalk.cyan(projectName)}`)}`);
        
        const projectResults = await runProjectVRT(
          browser,
          client,
          projectName,
          remoteUrl,
          {
            threshold,
            maxPages,
            maxDepth,
            outputDir,
            quantAuth,
            remoteAuth
          }
        );

        allResults.push(...projectResults);
      }
    } finally {
      if (browser) {
        await browser.close();
      }
    }

    // Display summary
    displaySummary(allResults);

    // Generate CSV if requested
    if (options.csv) {
      await generateCSV(allResults, options.csv);
      logger.info(`\nCSV report saved to: ${chalk.cyan(options.csv)}`);
    }

    // Exit with error if any test failed
    const hasFailures = allResults.some(r => r.status === 'FAIL' || r.status === 'ERROR');
    if (hasFailures) {
      process.exit(1);
    }

  } catch (error: any) {
    logger.error('VRT failed:', error.message);
    process.exit(1);
  }
}

async function runProjectVRT(
  browser: Browser,
  client: ApiClient,
  projectName: string,
  remoteUrl: string,
  options: {
    threshold: number;
    maxPages: number;
    maxDepth: number;
    outputDir: string;
    quantAuth?: string;
    remoteAuth?: string;
  }
): Promise<VRTResult[]> {
  const results: VRTResult[] = [];
  const spinner = createSpinner(`Fetching Quant project details for ${projectName}...`);

  try {
    // Fetch Quant project details
    const projectDetails = await client.getProjectDetails(projectName);
    
    // Try various possible domain field names from the API response
    // For cloud applications: aws_cloudfront_domain_name
    // For standard projects: domain, url, domains, primary_domain, etc.
    const quantUrl = projectDetails.aws_cloudfront_domain_name ||
                     projectDetails.domain || 
                     projectDetails.url || 
                     projectDetails.domains?.[0] ||
                     projectDetails.primary_domain ||
                     projectDetails.quantDomain;

    if (!quantUrl) {
      spinner.fail('Failed to get Quant URL');
      logger.debug('Project details:', JSON.stringify(projectDetails, null, 2));
      results.push({
        project: projectName,
        status: 'ERROR',
        quantUrl: '',
        remoteUrl,
        differencePercentage: 0,
        screenshot: '',
        timestamp: new Date().toISOString(),
        errorMessage: `Could not retrieve Quant project domain. Available fields: ${Object.keys(projectDetails).join(', ')}`
      });
      return results;
    }

    spinner.succeed(`Quant URL: ${chalk.blue(quantUrl)}`);
    logger.info(`Remote URL: ${chalk.blue(remoteUrl)}`);

    // Ensure URLs have protocol
    const normalizedQuantUrl = quantUrl.startsWith('http') ? quantUrl : `https://${quantUrl}`;
    const normalizedRemoteUrl = remoteUrl.startsWith('http') ? remoteUrl : `https://${remoteUrl}`;

    // Crawl pages
    const crawlSpinner = createSpinner('Crawling pages...');
    const pages = await crawlPages(browser, normalizedRemoteUrl, options.maxPages, options.maxDepth, options.remoteAuth);
    crawlSpinner.succeed(`Found ${pages.length} pages to test`);

    // Test each page
    for (const page of pages) {
      const pageSpinner = createSpinner(`Testing ${page.path}...`);
      
      try {
        const result = await comparePages(
          browser,
          normalizedQuantUrl + page.path,
          normalizedRemoteUrl + page.path,
          projectName,
          page.path,
          options.threshold,
          options.outputDir,
          options.quantAuth,
          options.remoteAuth
        );

        results.push(result);

        if (result.status === 'PASS') {
          pageSpinner.succeed(`${page.path} ${chalk.green('PASS')} (${result.differencePercentage.toFixed(2)}%)`);
        } else if (result.status === 'FAIL') {
          pageSpinner.fail(`${page.path} ${chalk.red('FAIL')} (${result.differencePercentage.toFixed(2)}%)`);
        } else {
          pageSpinner.fail(`${page.path} ${chalk.red('ERROR')}`);
        }
      } catch (error: any) {
        pageSpinner.fail(`${page.path} ${chalk.red('ERROR')}`);
        results.push({
          project: projectName,
          status: 'ERROR',
          quantUrl: normalizedQuantUrl + page.path,
          remoteUrl: normalizedRemoteUrl + page.path,
          differencePercentage: 0,
          screenshot: '',
          timestamp: new Date().toISOString(),
          errorMessage: error.message,
          pagePath: page.path
        });
      }
    }

  } catch (error: any) {
    spinner.fail(`Failed to test project ${projectName}`);
    logger.error(`Error: ${error.message}`);
    results.push({
      project: projectName,
      status: 'ERROR',
      quantUrl: '',
      remoteUrl,
      differencePercentage: 0,
      screenshot: '',
      timestamp: new Date().toISOString(),
      errorMessage: error.message
    });
  }

  return results;
}

async function crawlPages(
  browser: Browser,
  startUrl: string,
  maxPages: number,
  maxDepth: number,
  auth?: string
): Promise<CrawledPage[]> {
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  const pages: CrawledPage[] = [];
  const baseUrl = new URL(startUrl);

  const context = await browser.newContext({
    ...(auth && { httpCredentials: parseBasicAuth(auth) })
  });
  const page = await context.newPage();

  try {
    while (queue.length > 0 && pages.length < maxPages) {
      const { url, depth } = queue.shift()!;

      if (visited.has(url) || depth > maxDepth) {
        continue;
      }

      visited.add(url);

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        
        const currentUrl = new URL(page.url());
        const path = currentUrl.pathname + currentUrl.search;

        pages.push({ url: page.url(), path });

        // Only crawl deeper if we haven't reached max depth
        if (depth < maxDepth && pages.length < maxPages) {
          // Find all links on the page
          const links = await page.$$eval('a[href]', (anchors, base) => {
            return anchors
              .map(a => {
                try {
                  const href = a.getAttribute('href');
                  if (!href) return null;
                  return new URL(href, base).href;
                } catch {
                  return null;
                }
              })
              .filter(Boolean);
          }, baseUrl.origin);

          // Queue links from the same domain
          for (const link of links) {
            try {
              const linkUrl = new URL(link as string);
              if (linkUrl.origin === baseUrl.origin && !visited.has(link as string)) {
                queue.push({ url: link as string, depth: depth + 1 });
              }
            } catch {
              // Invalid URL, skip
            }
          }
        }
      } catch (error: any) {
        // Skip pages that fail to load
        logger.debug(`Failed to crawl ${url}: ${error.message}`);
      }
    }
  } finally {
    await page.close();
    await context.close();
  }

  return pages;
}

async function comparePages(
  browser: Browser,
  quantUrl: string,
  remoteUrl: string,
  projectName: string,
  pagePath: string,
  threshold: number,
  outputDir: string,
  quantAuth?: string,
  remoteAuth?: string
): Promise<VRTResult> {
  const timestamp = new Date().toISOString();
  const sanitizedPath = pagePath.replace(/[^a-zA-Z0-9]/g, '_');
  const projectDir = join(outputDir, projectName, timestamp.split('T')[0]);
  
  // Ensure output directory exists
  await fs.mkdir(projectDir, { recursive: true });

  // Create browser contexts with auth if provided
  const quantContext = await browser.newContext({
    ...(quantAuth && { httpCredentials: parseBasicAuth(quantAuth) })
  });
  const remoteContext = await browser.newContext({
    ...(remoteAuth && { httpCredentials: parseBasicAuth(remoteAuth) })
  });

  let quantPage: Page | null = null;
  let remotePage: Page | null = null;

  try {
    // Capture screenshots
    quantPage = await quantContext.newPage();
    remotePage = await remoteContext.newPage();

    await Promise.all([
      quantPage.goto(quantUrl, { waitUntil: 'networkidle', timeout: 30000 }),
      remotePage.goto(remoteUrl, { waitUntil: 'networkidle', timeout: 30000 })
    ]);

    const [quantScreenshot, remoteScreenshot] = await Promise.all([
      quantPage.screenshot({ fullPage: true }),
      remotePage.screenshot({ fullPage: true })
    ]);

    // Save screenshots
    const quantScreenshotPath = join(projectDir, `quant_${sanitizedPath}.png`);
    const remoteScreenshotPath = join(projectDir, `remote_${sanitizedPath}.png`);
    
    await Promise.all([
      fs.writeFile(quantScreenshotPath, quantScreenshot),
      fs.writeFile(remoteScreenshotPath, remoteScreenshot)
    ]);

    // Compare images
    const img1 = PNG.sync.read(quantScreenshot);
    const img2 = PNG.sync.read(remoteScreenshot);

    // Ensure images are the same size (resize if needed)
    const width = Math.max(img1.width, img2.width);
    const height = Math.max(img1.height, img2.height);

    const resizedImg1 = resizeImage(img1, width, height);
    const resizedImg2 = resizeImage(img2, width, height);

    const diff = new PNG({ width, height });
    const pixelsDiff = pixelmatch(
      resizedImg1.data,
      resizedImg2.data,
      diff.data,
      width,
      height,
      { threshold: 0.1 }
    );

    const totalPixels = width * height;
    const differencePercentage = (pixelsDiff / totalPixels) * 100;

    // Save diff image
    const diffPath = join(projectDir, `diff_${sanitizedPath}.png`);
    await fs.writeFile(diffPath, PNG.sync.write(diff));

    const status = differencePercentage <= (threshold * 100) ? 'PASS' : 'FAIL';

    return {
      project: projectName,
      status,
      quantUrl,
      remoteUrl,
      differencePercentage,
      screenshot: diffPath,
      timestamp,
      pagePath
    };

  } finally {
    if (quantPage) await quantPage.close();
    if (remotePage) await remotePage.close();
    await quantContext.close();
    await remoteContext.close();
  }
}

function resizeImage(img: PNG, width: number, height: number): PNG {
  if (img.width === width && img.height === height) {
    return img;
  }

  const resized = new PNG({ width, height });
  
  // Fill with white background
  for (let i = 0; i < resized.data.length; i += 4) {
    resized.data[i] = 255;     // R
    resized.data[i + 1] = 255; // G
    resized.data[i + 2] = 255; // B
    resized.data[i + 3] = 255; // A
  }

  // Copy original image data
  for (let y = 0; y < Math.min(img.height, height); y++) {
    for (let x = 0; x < Math.min(img.width, width); x++) {
      const srcIdx = (y * img.width + x) * 4;
      const dstIdx = (y * width + x) * 4;
      resized.data[dstIdx] = img.data[srcIdx];
      resized.data[dstIdx + 1] = img.data[srcIdx + 1];
      resized.data[dstIdx + 2] = img.data[srcIdx + 2];
      resized.data[dstIdx + 3] = img.data[srcIdx + 3];
    }
  }

  return resized;
}

function parseBasicAuth(auth: string): { username: string; password: string } {
  const [username, password] = auth.split(':');
  return { username, password };
}

function displaySummary(results: VRTResult[]) {
  logger.info('\n' + chalk.bold('=== VRT Summary ==='));
  
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const errors = results.filter(r => r.status === 'ERROR').length;
  const total = results.length;

  logger.info(`Total Tests: ${total}`);
  logger.info(`${chalk.green('Passed')}: ${passed}`);
  logger.info(`${chalk.red('Failed')}: ${failed}`);
  logger.info(`${chalk.yellow('Errors')}: ${errors}`);

  // Group by project
  const byProject = results.reduce((acc, r) => {
    if (!acc[r.project]) acc[r.project] = [];
    acc[r.project].push(r);
    return acc;
  }, {} as Record<string, VRTResult[]>);

  logger.info('\n' + chalk.bold('Results by Project:'));
  for (const [project, projectResults] of Object.entries(byProject)) {
    const projectPassed = projectResults.filter(r => r.status === 'PASS').length;
    const projectFailed = projectResults.filter(r => r.status === 'FAIL').length;
    const projectErrors = projectResults.filter(r => r.status === 'ERROR').length;

    logger.info(`\n${chalk.cyan(project)}:`);
    logger.info(`  ${chalk.green('✓')} ${projectPassed} passed`);
    if (projectFailed > 0) logger.info(`  ${chalk.red('✗')} ${projectFailed} failed`);
    if (projectErrors > 0) {
      logger.info(`  ${chalk.yellow('⚠')} ${projectErrors} errors`);
      
      // Show error messages
      const errorResults = projectResults.filter(r => r.status === 'ERROR');
      errorResults.forEach(r => {
        if (r.errorMessage) {
          const location = r.pagePath ? ` (${r.pagePath})` : '';
          logger.info(`    ${chalk.gray('→')} ${chalk.red(r.errorMessage)}${location}`);
        }
      });
    }
  }
}

async function generateCSV(results: VRTResult[], filename: string): Promise<void> {
  const headers = [
    'project',
    'status',
    'quant_url',
    'remote_url',
    'difference_percentage',
    'screenshot',
    'timestamp',
    'error_message',
    'page_path'
  ];

  const rows = results.map(r => [
    r.project,
    r.status,
    r.quantUrl,
    r.remoteUrl,
    r.differencePercentage.toFixed(4),
    r.screenshot,
    r.timestamp,
    r.errorMessage || '',
    r.pagePath || '/'
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  await fs.writeFile(filename, csv, 'utf-8');
}

