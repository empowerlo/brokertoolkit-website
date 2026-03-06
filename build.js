#!/usr/bin/env node

/**
 * Broker Toolkit — Build Script
 * Reads src/pages/, injects partials, handles active nav, outputs to root.
 */

const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');
const { minify: terserMinify } = require('terser');
const crypto = require('crypto');

const ROOT = __dirname;
const PAGES_DIR = path.join(ROOT, 'src', 'pages');
const PARTIALS_DIR = path.join(ROOT, 'src', 'partials');

const navHtml = fs.readFileSync(path.join(PARTIALS_DIR, 'nav.html'), 'utf8');
const footerHtml = fs.readFileSync(path.join(PARTIALS_DIR, 'footer.html'), 'utf8');
const modalHtml = fs.readFileSync(path.join(PARTIALS_DIR, 'modal.html'), 'utf8');

// Load and minify critical CSS for inlining
const criticalCssRaw = fs.readFileSync(path.join(ROOT, 'src', 'critical.css'), 'utf8');
const criticalCss = new CleanCSS({ level: 2 }).minify(criticalCssRaw).styles;

// Cache-busting hashes
const cssHash = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'src', 'styles.css'))).digest('hex').slice(0, 8);
const jsHash = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'src', 'main.js'))).digest('hex').slice(0, 8);
console.log(`Cache busters: styles.css?v=${cssHash} main.js?v=${jsHash}`);

function findPages(dir, base = '') {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findPages(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.html')) {
      results.push(rel);
    }
  }
  return results;
}

const pages = findPages(PAGES_DIR);
console.log(`Building ${pages.length} page(s)...\n`);

for (const page of pages) {
  const srcPath = path.join(PAGES_DIR, page);
  let content = fs.readFileSync(srcPath, 'utf8');

  const depth = page.split(path.sep).length - 1;
  const prefix = depth > 0 ? '../'.repeat(depth) : '';

  let activeNavId = null;
  const activeNavMatch = content.match(/<!--\s*ACTIVE_NAV:\s*(\w[\w-]*)\s*-->/);
  if (activeNavMatch) {
    activeNavId = activeNavMatch[1];
    content = content.replace(activeNavMatch[0], '').trimStart();
  }

  let processedNav = navHtml;
  let processedFooter = footerHtml;
  if (depth > 0) {
    const fixPaths = (html) => html
      .replace(/href="(?!https?:\/\/|#|mailto:)([^"]+)"/g, `href="${prefix}$1"`)
      .replace(/src="(?!https?:\/\/)([^"]+)"/g, `src="${prefix}$1"`);
    processedNav = fixPaths(processedNav);
    processedFooter = fixPaths(processedFooter);
  }

  if (activeNavId) {
    processedNav = processedNav.replace(
      new RegExp(`(<(?:a|div)\\s[^>]*data-nav-id="${activeNavId}"[^>]*)>`),
      '$1 class="nav-active">'
    );
  }

  content = content.replace('<!-- NAV -->', processedNav);
  content = content.replace('<!-- FOOTER -->', processedFooter);
  content = content.replace('<!-- MODAL -->', modalHtml);

  // Replace styles.css with inline critical CSS + deferred full CSS
  const stylesHref = depth > 0 ? `${prefix}styles.css?v=${cssHash}` : `styles.css?v=${cssHash}`;
  content = content.replace(
    /\s*<link rel="stylesheet" href="styles\.css">\s*/,
    `\n  <style>${criticalCss}</style>\n  <link rel="preload" href="${stylesHref}" as="style" onload="this.onload=null;this.rel='stylesheet'">\n  <noscript><link rel="stylesheet" href="${stylesHref}"></noscript>\n`
  );

  // Cache-bust main.js
  if (depth > 0) {
    content = content.replace(/src="main\.js"/g, `src="${prefix}main.js?v=${jsHash}"`);
  } else {
    content = content.replace(/src="main\.js"/g, `src="main.js?v=${jsHash}"`);
  }

  // Default OG image
  if (!content.includes('og:image')) {
    const defaultOg = `<meta property="og:image" content="https://brokertoolkit.app/assets/og-image.png">\n  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">\n  <meta name="twitter:card" content="summary_large_image">\n  <meta name="twitter:image" content="https://brokertoolkit.app/assets/og-image.png">`;
    content = content.replace('</head>', defaultOg + '\n</head>');
  }

  // Google Tag Manager (head) — as high as possible
  const gtmHead = `<!-- Google Tag Manager -->\n  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':\n  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],\n  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=\n  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);\n  })(window,document,'script','dataLayer','GTM-53N4ZRS3');</script>\n  <!-- End Google Tag Manager -->`;
  content = content.replace('<head>', '<head>\n  ' + gtmHead);

  // Google Tag Manager (noscript) — immediately after <body>
  const gtmBody = `<!-- Google Tag Manager (noscript) -->\n<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-53N4ZRS3"\nheight="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n<!-- End Google Tag Manager (noscript) -->`;
  content = content.replace(/<body([^>]*)>/, `<body$1>\n${gtmBody}`);

  // Preconnect hints
  const preconnects = `<link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`;
  content = content.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n  ' + preconnects);

  const outPath = path.join(ROOT, page);
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, content);
  console.log(`  ✓ ${page}${activeNavId ? ` (active: ${activeNavId})` : ''}`);
}

// Minify styles.css
console.log('\nMinifying styles.css...');
const stylesRaw = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8');
const stylesMinified = new CleanCSS({ level: 2 }).minify(stylesRaw);
fs.writeFileSync(path.join(ROOT, 'styles.css'), stylesMinified.styles);
console.log(`  ✓ styles.css: ${stylesRaw.length} → ${stylesMinified.styles.length} bytes`);

// Minify main.js
console.log('Minifying main.js...');
const mainJsRaw = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
terserMinify(mainJsRaw, { compress: true, mangle: true }).then(result => {
  fs.writeFileSync(path.join(ROOT, 'main.js'), result.code);
  console.log(`  ✓ main.js: ${mainJsRaw.length} → ${result.code.length} bytes`);
  console.log('\nBuild complete!');
}).catch(err => {
  console.error('  ✗ main.js minification failed:', err.message);
});
