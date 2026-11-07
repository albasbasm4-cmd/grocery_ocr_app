import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

export interface JavaProductInput {
  id: string;
  name: string;
  barcode?: string | null;
  sku_small_text?: string | null;
  category_name?: string | null;
  unit: string;
  price: number | string;
  cost_price?: number | string | null;
  stock_quantity: number | string;
  min_stock?: number | string | null;
  expiry_date?: string | null;
}

export interface JavaExportOptions {
  packageName?: string;
  repositoryClassName?: string;
}

/**
 * تهريب النصوص بأمان تام لكود Java
 * يتعامل مع الشرطة المائلة، علامات الاقتباس، الأسطر الجديدة، والمحارف الخاصة
 */
export function escapeJavaString(str: string | null | undefined): string {
  if (str === null || str === undefined) return 'null';
  let escaped = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = str.charCodeAt(i);
    if (ch === '\\') escaped += '\\\\';
    else if (ch === '"') escaped += '\\"';
    else if (ch === '\n') escaped += '\\n';
    else if (ch === '\r') escaped += '\\r';
    else if (ch === '\t') escaped += '\\t';
    else if (code < 32) escaped += `\\u${code.toString(16).padStart(4, '0')}`;
    else escaped += ch;
  }
  return `"${escaped}"`;
}

/**
 * صياغة أرقام BigDecimal للأسعار والكميات في Java
 */
export function formatJavaBigDecimal(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '') return 'null';
  const clean = String(val).trim();
  if (!/^\d+(?:\.\d+)?$/.test(clean) || !Number.isFinite(Number(clean))) return 'null';
  return `new BigDecimal("${clean}")`;
}

/**
 * صياغة التواريخ LocalDate
 */
export function formatJavaLocalDate(val: string | null | undefined): string {
  if (!val || !/^\d{4}-\d{2}-\d{2}/.test(val)) return 'null';
  const dateOnly = val.slice(0, 10);
  const parts = dateOnly.split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 0;
  const day = parts[2] ?? 0;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return 'null';
  return `LocalDate.parse("${dateOnly}")`;
}

/**
 * توليد كود كلاس Product
 */
export function generateProductClassCode(asStaticInner = true): string {
  const classDeclaration = asStaticInner ? 'public static class Product {' : 'public class Product {';

  return `    ${classDeclaration}
        private String id;
        private String name;
        private String barcode;
        private String skuSmallText;
        private String categoryName;
        private String unit;
        private BigDecimal price;
        private BigDecimal costPrice;
        private BigDecimal stockQuantity;
        private BigDecimal minStock;
        private LocalDate expiryDate;

        public Product() {
        }

        public Product(
            String id,
            String name,
            String barcode,
            String skuSmallText,
            String categoryName,
            String unit,
            BigDecimal price,
            BigDecimal costPrice,
            BigDecimal stockQuantity,
            BigDecimal minStock,
            LocalDate expiryDate
        ) {
            this.id = id;
            this.name = name;
            this.barcode = barcode;
            this.skuSmallText = skuSmallText;
            this.categoryName = categoryName;
            this.unit = unit;
            this.price = price;
            this.costPrice = costPrice;
            this.stockQuantity = stockQuantity;
            this.minStock = minStock;
            this.expiryDate = expiryDate;
        }

        // Getters and Setters
        public String getId() { return id; }
        public void setId(String id) { this.id = id; }

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }

        public String getBarcode() { return barcode; }
        public void setBarcode(String barcode) { this.barcode = barcode; }

        public String getSkuSmallText() { return skuSmallText; }
        public void setSkuSmallText(String skuSmallText) { this.skuSmallText = skuSmallText; }

        public String getCategoryName() { return categoryName; }
        public void setCategoryName(String categoryName) { this.categoryName = categoryName; }

        public String getUnit() { return unit; }
        public void setUnit(String unit) { this.unit = unit; }

        public BigDecimal getPrice() { return price; }
        public void setPrice(BigDecimal price) { this.price = price; }

        public BigDecimal getCostPrice() { return costPrice; }
        public void setCostPrice(BigDecimal costPrice) { this.costPrice = costPrice; }

        public BigDecimal getStockQuantity() { return stockQuantity; }
        public void setStockQuantity(BigDecimal stockQuantity) { this.stockQuantity = stockQuantity; }

        public BigDecimal getMinStock() { return minStock; }
        public void setMinStock(BigDecimal minStock) { this.minStock = minStock; }

        public LocalDate getExpiryDate() { return expiryDate; }
        public void setExpiryDate(LocalDate expiryDate) { this.expiryDate = expiryDate; }

        @Override
        public String toString() {
            return "Product{" +
                "id='" + id + '\\'' +
                ", name='" + name + '\\'' +
                ", barcode='" + barcode + '\\'' +
                ", skuSmallText='" + skuSmallText + '\\'' +
                ", categoryName='" + categoryName + '\\'' +
                ", unit='" + unit + '\\'' +
                ", price=" + price +
                ", costPrice=" + costPrice +
                ", stockQuantity=" + stockQuantity +
                ", minStock=" + minStock +
                ", expiryDate=" + expiryDate +
                '}';
        }
    }`;
}

/**
 * توليد كود ملف Java الموحد الجاهز للتصريف المباشر (Self-contained and Compilable)
 */
export function generateJavaSourceCode(
  products: JavaProductInput[],
  options: JavaExportOptions = {}
): string {
  const requestedClass = options.repositoryClassName || 'ProductRepository';
  const className = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(requestedClass) ? requestedClass : 'ProductRepository';
  const requestedPackage = options.packageName;
  const validPackage = requestedPackage && requestedPackage.split('.').every((part) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part));
  const pkg = validPackage ? `package ${requestedPackage};\n\n` : '';

  const productInstantiations = products
    .map((p) => {
      const id = escapeJavaString(p.id);
      const name = escapeJavaString(p.name);
      const barcode = escapeJavaString(p.barcode);
      const sku = escapeJavaString(p.sku_small_text);
      const cat = escapeJavaString(p.category_name);
      const unit = escapeJavaString(p.unit || 'piece');
      const price = formatJavaBigDecimal(p.price);
      const costPrice = formatJavaBigDecimal(p.cost_price);
      const stock = formatJavaBigDecimal(p.stock_quantity);
      const minStock = formatJavaBigDecimal(p.min_stock);
      const expiry = formatJavaLocalDate(p.expiry_date);

      return `        products.add(new Product(\n            ${id},\n            ${name},\n            ${barcode},\n            ${sku},\n            ${cat},\n            ${unit},\n            ${price},\n            ${costPrice},\n            ${stock},\n            ${minStock},\n            ${expiry}\n        ));`;
    })
    .join('\n\n');

  return `${pkg}import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * كود Java تم توليده تلقائياً من تطبيق بقالة POS
 * عدد المنتجات: ${products.length}
 */
public class ${className} {

${generateProductClassCode(true)}

    /**
     * جلب قائمة كل منتجات المتجر كـ ArrayList معبأة بالكامل
     */
    public static List<Product> getAllProducts() {
        List<Product> products = new ArrayList<>();
${productInstantiations ? '\n' + productInstantiations : ''}
        return Collections.unmodifiableList(products);
    }

    /**
     * دالة التشغيل الرئيسية للاختبار السريع
     */
    public static void main(String[] args) {
        List<Product> list = getAllProducts();
        System.out.println("=== مستودع منتجات بقالة POS ===");
        System.out.println("إجمالي المنتجات المحملة: " + list.size());
        for (int i = 0; i < Math.min(list.size(), 5); i++) {
            System.out.println((i + 1) + ". " + list.get(i));
        }
    }
}
`;
}

/**
 * تنزيل الكود كملف .java
 */
export function downloadJavaFile(code: string, fileName = 'ProductRepository.java'): void {
  const blob = new Blob([code], { type: 'text/x-java-source;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * مشاركة كود Java عبر نظام Android أو Web Share API
 */
export async function shareJavaCode(code: string, fileName = 'ProductRepository.java'): Promise<void> {
  let uri: string;
  try {
    const result = await Filesystem.writeFile({
      path: fileName,
      data: code,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    uri = result.uri;
  } catch {
    if (navigator.share) {
      await navigator.share({ title: fileName, text: code });
      return;
    }
    downloadJavaFile(code, fileName);
    return;
  }

  await Share.share({
    title: 'تصدير كود Java لمنتجات المتجر',
    text: `مستودع كود Java لمنتجات المتجر (${fileName})`,
    files: [uri],
    dialogTitle: 'مشاركة ملف Java',
  });
}
