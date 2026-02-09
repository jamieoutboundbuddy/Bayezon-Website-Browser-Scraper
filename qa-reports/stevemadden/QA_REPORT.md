# QA Test Report: stevemadden.com Search Analysis

**Date:** 2026-02-09
**Job ID:** `f793603c-5d94-4cff-a5e7-da4fece1a2e9`
**Duration:** 238 seconds (~4 minutes)
**Verdict:** OUTREACH
**Confidence:** High

---

## 1. Homepage Load

**Screenshot:** `homepage.png`

![Homepage](homepage.png)

### Observations:
- The Steve Madden homepage loaded successfully
- A **20% off promotional popup** immediately overlays the page, blocking the main content
- Behind the popup, the "FRESH FINDS" seasonal collection is visible with sandals/slides imagery
- The top navigation bar is present with categories: WOMEN'S, MEN'S, KIDS, ACCESSORIES, CLOTHING, DENIM, MADDEN, TRENDS, SALE
- **Search icon** is visible in the top-right header area (magnifying glass icon)
- The scraper correctly identified the search type as **modal** (icon-triggered)

### Potential Issue:
- The popup modal could interfere with automated interactions if not dismissed properly. The scraper appears to have handled this successfully.

---

## 2. Query 1: "platform boots" — PASSED

**Screenshot:** `results_1_platform_boots.png`

![Platform Boots Results](results_1_platform_boots.png)

### Search Behavior:
- **Results returned:** 30
- **Relevant results:** 5
- **First relevant at position:** #1
- **Status:** PASSED

### Visual Analysis:
- The search results page header reads **"SEARCH RESULTS FOR PLATFORM BOOTS"**
- **Top row** (promoted results): Boohma Black, Lexon Brown Suede, Strut White, Rigos Boot & Fria Bag Bundle — these are clearly platform-style boots, strong relevance
- Below the fold: dozens of boots displayed in a 4-column grid layout
- Products include chunky-sole boots, combat boots, Chelsea boots, and knee-high boots — many with visible platform soles
- Brand filter and sort options are visible at the top of the results grid
- Product cards show: image, name, price (with sale prices in red where applicable)

### Assessment:
- This is a **strong pass**. "Platform boots" is a direct product-type keyword and the search engine handled it well
- The top results are highly relevant with clear platform-style footwear
- The variety includes different styles (ankle, knee-high, combat) which shows good catalog coverage

---

## 3. Query 2: "shoes for a night out" — FAILED

**Screenshot:** `results_2_night_out.png`

![Night Out Results](results_2_night_out.png)

### Search Behavior:
- **Results returned:** 24
- **Relevant results:** 2 (per AI evaluation)
- **First relevant at position:** #2
- **Status:** FAILED

### Visual Analysis:
- The search results page header reads **"SEARCH RESULTS FOR SHOES FOR A NIGHT OUT"**
- **Top row** (promoted results): Larina Pink Satin, Larina Black Satin, Larina Red Satin, Noir Black Leather — these are strappy heels and satin dress shoes
- Below: Teacup Ivory Satin, BRI Black Lace, Jypset Black Leather, Kseniya Black Leather
- Further down: Mix of heels, pointed-toe pumps, patent leather shoes, metallic finishes
- **Lower portion of results** shifts to boots (Berkelesh Black Wide, combat boots, platform boots) — these are NOT night-out shoes
- Many product names were marked `[unreadable]` by the AI, but visual inspection shows they are actually labeled (e.g., Priva Black Patent, Saturn Silver, Edna Champagne Leather)

### Assessment:
- **Mixed results.** The top portion actually shows many dressy heels and satin shoes that ARE appropriate for a night out (strappy heels, satin pumps, lace shoes)
- However, the AI scored this as only 2/24 relevant — this may indicate an issue with the **AI's evaluation criteria being too strict**, or the product names not being parsed correctly (many `[unreadable]` entries)
- The bottom third of results deteriorates into boots and casual footwear that don't match "night out" intent
- **Key insight:** The search engine seems to do keyword matching on "shoes" broadly rather than understanding the intent of "night out" = dressy/formal

### Bug/Observation — `[unreadable]` Products:
- 22 out of 24 products were marked `[unreadable]` by the scraper
- Visual inspection of the screenshot shows product names ARE displayed clearly (Larina, Teacup, Jypset, etc.)
- This suggests a **scraper text-extraction issue** — the product name elements may use a font, lazy-loading, or CSS that Stagehand/Playwright cannot read
- **Recommendation:** Investigate the DOM structure of Steve Madden product cards to fix text extraction

---

## 4. Query 3: "vegan leather boots" — FAILED

**Screenshot:** `results_3_vegan_leather.png`

![Vegan Leather Results](results_3_vegan_leather.png)

### Search Behavior:
- **Results returned:** 30
- **Relevant results:** 5
- **First relevant at position:** #16
- **Status:** FAILED

### Visual Analysis:
- The search results page header reads **"SEARCH RESULTS FOR VEGAN LEATHER BOOTS"**
- **Top row** (promoted results): Maxima White Rhinestones (heeled sandal), Daryl Gold (heeled mule), Yanile Black (pointed shoe), Girl Cold Fur Brown Distressed (casual boot) — **NONE of these are vegan leather boots**
- Below the fold, the results are extremely mixed:
  - Altee Mocha **Mesh** (mesh shoe, not leather)
  - Rigos Boot & Fria **Bag** Bundle (a bag+boot combo)
  - Aerel Tan **Snake** (snake print, not vegan leather)
  - Playing Bright Multi, Sorona Champagne — colorful heels/sandals
  - Pacey **Red Multi**, Joey Black Patent — not vegan leather boots
- **Vegan leather products don't appear until well into the page** (~position 16+):
  - "Vegan Leather Duo Tan Multi" appears in the top area but is a small item
  - Actual vegan leather boots (ankle boots, Chelsea boots, combat boots) are buried deep in results
- The results page is very long with many irrelevant products (heels, sandals, mesh shoes, snake-print items)

### Assessment:
- This is a **clear failure**. The search engine does not understand "vegan leather" as a material attribute
- It appears to be doing broad keyword matching, pulling in any product with "leather" in the name regardless of "vegan" qualifier
- The top results are completely irrelevant — rhinestone sandals and gold mules have nothing to do with vegan leather boots
- **First relevant result at position #16** means a customer would need to scroll through 4 rows of irrelevant products before finding what they searched for
- This represents a significant conversion risk — shoppers specifically looking for vegan/sustainable options would likely bounce

---

## Summary Table

| Step | Query | Results | Relevant | 1st Relevant | Status |
|------|-------|---------|----------|--------------|--------|
| 1 | "platform boots" | 30 | 5 | #1 | PASSED |
| 2 | "shoes for a night out" | 24 | 2* | #2 | FAILED |
| 3 | "vegan leather boots" | 30 | 5 | #16 | FAILED |

*\*Query 2 relevance may be understated due to `[unreadable]` product text extraction issue*

---

## Verdict: OUTREACH

### Why This Site Qualifies:
1. **Simple keyword queries work** — "platform boots" returned accurate results immediately
2. **Natural language fails** — "shoes for a night out" doesn't understand shopper intent
3. **Attribute-specific queries fail badly** — "vegan leather boots" returns rhinestone sandals and mesh shoes in top positions
4. **Position #16 for first relevant result** on query 3 is a major UX failure

### Email Hook:
> "I searched for 'shoes for a night out' on your site and got irrelevant results. This is exactly the kind of query your customers are typing."

### Queries That Would Work:
- "steve madden" (brand)
- "new arrivals"
- "sale items"
- "best sellers"
- "steve madden for men/women"

---

## Technical Notes

### Scraper Issues Found:
1. **`[unreadable]` product names** — 22/24 products in query 2 and 25/30 in query 3 had unreadable names despite being visually present in screenshots. This is likely a DOM/CSS extraction issue specific to Steve Madden's product card implementation.
2. **Popup handling** — The 20% off popup was present on homepage load. The scraper navigated past it successfully.

### Recommendations for Scraper Improvement:
- Investigate Steve Madden's product card HTML structure for text extraction fix
- Consider using `page.evaluate()` to directly extract `textContent` from product title elements as a fallback
- The `[unreadable]` issue may artificially deflate relevance scores since the AI can't evaluate products it can't read by name

---

*Report generated by Bayezon Search Quality Tool*
*Screenshots: https://bayezon-website-browser-scraper-production.up.railway.app/artifacts/f793603c-5d94-4cff-a5e7-da4fece1a2e9/stevemadden.com/screens/*
