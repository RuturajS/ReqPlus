const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const src = 'C:\\Users\\rutur\\.gemini\\antigravity\\brain\\353aff7c-0462-48dd-a95c-98a368d576f4\\reqplus_icon_1773160287067.png';
const outDir = 'c:\\Users\\rutur\\OneDrive\\Desktop\\Ai-Projects\\ReqPlus\\Reqplus\\icons';

fs.mkdirSync(outDir, { recursive: true });

const sizes = [16, 32, 48, 128];

Promise.all(sizes.map(size =>
    sharp(src)
        .resize(size, size)
        .png()
        .toFile(path.join(outDir, `icon${size}.png`))
        .then(() => console.log(`icon${size}.png done`))
)).then(() => console.log('All icons created!'));
