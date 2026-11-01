-- Skip the snapshot function for lifecycle-only and no-op product updates.
-- Real card edits still use the existing authorization/undo/retention logic.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS products_capture_action_history ON public.products;

-- Keep this predicate aligned with capture_action_history_update's product whitelist.
-- Evaluate typed OLD/NEW values before invoking the JSON snapshot trigger function.
-- supplier_name is citext; cast to text to preserve case-only edits like JSONB does.
CREATE TRIGGER products_capture_action_history AFTER UPDATE ON public.products
FOR EACH ROW
WHEN (
  ROW(
    OLD.name, OLD.category, OLD.metal, OLD.metal_color, OLD.weight, OLD.size,
    OLD.purchase_price, OLD.purchase_price_visible, OLD.price_per_gram_sale,
    OLD.price_per_gram_purchase, OLD.price_per_gram_purchase_visible,
    OLD.stones, OLD.description, OLD.sale_price, OLD.image_url, OLD.images,
    OLD.supplier_name::text, OLD.supplier_phone, OLD.is_hidden
  ) IS DISTINCT FROM ROW(
    NEW.name, NEW.category, NEW.metal, NEW.metal_color, NEW.weight, NEW.size,
    NEW.purchase_price, NEW.purchase_price_visible, NEW.price_per_gram_sale,
    NEW.price_per_gram_purchase, NEW.price_per_gram_purchase_visible,
    NEW.stones, NEW.description, NEW.sale_price, NEW.image_url, NEW.images,
    NEW.supplier_name::text, NEW.supplier_phone, NEW.is_hidden
  )
)
EXECUTE FUNCTION public.capture_action_history_update('product');

COMMIT;
