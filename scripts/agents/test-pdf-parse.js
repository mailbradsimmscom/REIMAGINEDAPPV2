import { readFileSync } from 'fs';
import { PDFParse } from 'pdf-parse';

const pdfPath = 'scripts/agents/manual-hunter-results/pdfs-test/Acr_epirb_beacon_programming_certificate.pdf';
const buffer = readFileSync(pdfPath);

const parser = new PDFParse({});

// Load the PDF first, then getText
parser.load(buffer).then(() => {
  return parser.getText();
}).then(text => {
  console.log('Text length:', text.length);
  console.log('First 500 chars:', text.substring(0, 500));
}).catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
