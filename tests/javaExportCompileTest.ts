import { generateJavaSourceCode, JavaProductInput } from '../src/services/javaExportService';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const sampleProducts: JavaProductInput[] = [
  {
    id: 'prod-001-uuid',
    name: 'أرز بسمتي 5 كجم "درجة أولى" \\ هندي ممتاز',
    barcode: '6281001234567',
    sku_small_text: 'SKU/001-A',
    category_name: 'حبوب وبقوليات',
    unit: 'كيس',
    price: '45.50',
    cost_price: '38.00',
    stock_quantity: '20.000',
    min_stock: '5.000',
    expiry_date: '2027-12-31',
  },
  {
    id: 'prod-002-uuid',
    name: 'حليب كامل الدسم (1.5 لتر)\nمبرد وطازج\t"عرض خاص"',
    barcode: '6281007654321',
    sku_small_text: null,
    category_name: 'ألبان وأجبان',
    unit: 'حبة',
    price: '9.25',
    cost_price: '7.50',
    stock_quantity: '100.500',
    min_stock: '15.000',
    expiry_date: '2026-11-20',
  },
  {
    id: 'prod-003-uuid',
    name: 'شوكولاتة بالبندق 100% طبيعية "Luxury" / نكهة خاصة',
    barcode: null,
    sku_small_text: 'SKU-CHOC-99',
    category_name: null,
    unit: 'قطعة',
    price: 15.00,
    cost_price: null,
    stock_quantity: 0,
    min_stock: 0,
    expiry_date: null,
  },
  {
    id: 'prod-004-uuid',
    name: 'بهارات مشكلة: قرفة، كمون، فلفل أسود & كاري (خلطة رقم #1)',
    barcode: '123456789012',
    sku_small_text: 'SPICE-01',
    category_name: 'توابل وبهارات',
    unit: 'علبة',
    price: '18.75',
    cost_price: '12.00',
    stock_quantity: '34.000',
    min_stock: '10.000',
    expiry_date: '2028-06-15',
  },
];

console.log('Generating Java source code for test products...');
const javaCode = generateJavaSourceCode(sampleProducts, {
  repositoryClassName: 'TestProductRepository',
});

const tempDir = '/tmp/java_test_compile';
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const javaFilePath = path.join(tempDir, 'TestProductRepository.java');
fs.writeFileSync(javaFilePath, javaCode, 'utf8');
console.log(`Saved Java source file to ${javaFilePath}`);

console.log('Compiling Java file using javac (UTF-8)...');
try {
  execSync(`nix-shell -p openjdk --run "javac -encoding UTF-8 ${javaFilePath}"`, {
    stdio: 'inherit',
    env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' },
  });
  console.log('javac Compilation: SUCCESSFUL!');

  console.log('Executing compiled Java class...');
  const runOutput = execSync(
    `nix-shell -p openjdk --run "java -cp ${tempDir} -Dfile.encoding=UTF-8 TestProductRepository"`,
    {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' },
    }
  );
  console.log('Java Execution Output:\n' + runOutput);

  if (!runOutput.includes('4') || !runOutput.includes('prod-001-uuid')) {
    throw new Error('Test failed: Output does not contain expected products');
  }

  console.log('ALL JAVA EXPORT COMPILATION & RUNTIME TESTS PASSED SUCCESSFULLY!');
} catch (error) {
  console.error('Java compilation or execution FAILED:', error);
  process.exit(1);
}
