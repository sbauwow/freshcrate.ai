-- Normalize historical page_view paths polluted with tracking query params.
-- Keeps non-tracking query params (e.g. /search?q=foo) while stripping UTM/click ids.

WITH RECURSIVE tracked(id, path) AS (
  SELECT id, path
  FROM page_views
  WHERE path LIKE '%?%'
    AND (
      path LIKE '%utm_source=%' OR
      path LIKE '%utm_medium=%' OR
      path LIKE '%utm_campaign=%' OR
      path LIKE '%utm_term=%' OR
      path LIKE '%utm_content=%' OR
      path LIKE '%gclid=%' OR
      path LIKE '%fbclid=%' OR
      path LIKE '%msclkid=%'
    )
),
seed AS (
  SELECT
    id,
    CASE WHEN instr(path, '?') > 0 THEN substr(path, 1, instr(path, '?') - 1) ELSE path END AS base,
    CASE WHEN instr(path, '?') > 0 THEN substr(path, instr(path, '?') + 1) ELSE '' END AS rest
  FROM tracked
),
parts(id, base, idx, piece, rest, keep) AS (
  SELECT
    id,
    base,
    1,
    CASE WHEN instr(rest, '&') > 0 THEN substr(rest, 1, instr(rest, '&') - 1) ELSE rest END,
    CASE WHEN instr(rest, '&') > 0 THEN substr(rest, instr(rest, '&') + 1) ELSE '' END,
    CASE
      WHEN lower(
        CASE
          WHEN instr(CASE WHEN instr(rest, '&') > 0 THEN substr(rest, 1, instr(rest, '&') - 1) ELSE rest END, '=') > 0
            THEN substr(CASE WHEN instr(rest, '&') > 0 THEN substr(rest, 1, instr(rest, '&') - 1) ELSE rest END, 1, instr(CASE WHEN instr(rest, '&') > 0 THEN substr(rest, 1, instr(rest, '&') - 1) ELSE rest END, '=') - 1)
          ELSE CASE WHEN instr(rest, '&') > 0 THEN substr(rest, 1, instr(rest, '&') - 1) ELSE rest END
        END
      ) IN ('utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'msclkid')
      THEN 0 ELSE 1
    END
  FROM seed
  WHERE rest <> ''

  UNION ALL

  SELECT
    id,
    base,
    idx + 1,
    CASE WHEN instr(rest, '&') > 0 THEN substr(rest, 1, instr(rest, '&') - 1) ELSE rest END,
    CASE WHEN instr(rest, '&') > 0 THEN substr(rest, instr(rest, '&') + 1) ELSE '' END,
    CASE
      WHEN lower(
        CASE
          WHEN instr(CASE WHEN instr(rest, '&') > 0 THEN substr(rest, 1, instr(rest, '&') - 1) ELSE rest END, '=') > 0
            THEN substr(CASE WHEN instr(rest, '&') > 0 THEN substr(rest, 1, instr(rest, '&') - 1) ELSE rest END, 1, instr(CASE WHEN instr(rest, '&') > 0 THEN substr(rest, 1, instr(rest, '&') - 1) ELSE rest END, '=') - 1)
          ELSE CASE WHEN instr(rest, '&') > 0 THEN substr(rest, 1, instr(rest, '&') - 1) ELSE rest END
        END
      ) IN ('utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'msclkid')
      THEN 0 ELSE 1
    END
  FROM parts
  WHERE rest <> ''
),
normalized AS (
  SELECT
    s.id,
    s.base ||
      CASE
        WHEN EXISTS (SELECT 1 FROM parts p WHERE p.id = s.id AND p.keep = 1 AND p.piece <> '')
          THEN '?' || (
            SELECT group_concat(piece, '&')
            FROM (
              SELECT piece
              FROM parts p2
              WHERE p2.id = s.id AND p2.keep = 1 AND p2.piece <> ''
              ORDER BY idx
            ) ordered
          )
        ELSE ''
      END AS new_path
  FROM seed s
)
UPDATE page_views
SET path = (SELECT new_path FROM normalized WHERE normalized.id = page_views.id)
WHERE id IN (SELECT id FROM normalized)
  AND path <> (SELECT new_path FROM normalized WHERE normalized.id = page_views.id);
