ARCHICOLOR AI — STAGE 4 DESIGN SYSTEM UNIFICATION

Goal
- Treat the already-installed "Подбор цвета" page as the visual source of truth.
- Change ArchiColor AI only. No files from the installed Podbor page need replacement.

What Stage 4 changes
- Reuses exact Podbor design tokens: colors, radii, shadows, focus/hover behavior.
- Aligns hero, upload studio, style chips, result comparison, CIEDE2000 bridge,
  color cards, harmony cards, modals, progress and empty states.
- Strengthens visual continuity in the commercial flow: real color -> product -> basket.
- Improves mobile modal treatment and focus visibility.

What Stage 4 does NOT change
- D8 / AI generation backend.
- color_search_core.php / get_product_options_v3.php / add_to_basket_v3.php logic.
- Existing element IDs or ai.js event contracts.
- Standard Bitrix header/footer.
- Installed "Подбор цвета" page.

Deploy
Copy this package preserving paths. The only new Stage 4 asset is:
/assets/css/ai-stage4-design-system.css
index.php loads it after Stage 1-3 CSS so it acts as a safe scoped override.
