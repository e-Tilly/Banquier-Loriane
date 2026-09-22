/** CLI: validate the taxonomy and print a summary. Run in CI — a broken vocabulary
 *  must never reach a catalog export. */
import { loadTaxonomy, allSlugs, aiAssertableSlugs } from "./load.ts";

const t = loadTaxonomy();
const slugs = allSlugs(t);
const assertable = aiAssertableSlugs(t);

console.log(`taxonomy v${t.version}`);
console.log(`  locales   ${t.locales.join(", ")}`);
console.log(`  facets    ${t.facets.length}`);
console.log(`  tags      ${slugs.length}`);
console.log(`  shelves   ${t.shelves.length}`);
console.log(`  AI may assert ${assertable.length}/${slugs.length}` +
  `  (withheld: ${slugs.length - assertable.length})`);

if (slugs.length > 350) {
  console.warn("\n⚠ Over 350 tags — doc 03 says merge ruthlessly past this point.");
}
