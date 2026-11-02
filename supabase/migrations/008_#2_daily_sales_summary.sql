-- Lightweight, on-demand daily report aggregation.
-- No rollup table is created, so report usage does not add rows or storage.
CREATE OR REPLACE FUNCTION public.get_daily_sales_summary(
  _from timestamptz,
  _to timestamptz
)
RETURNS TABLE (
  report_day date,
  revenue numeric,
  cost numeric,
  profit numeric,
  receipt_count bigint,
  refund_amount numeric,
  refund_cost numeric,
  return_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_shop_id uuid := public.current_shop_id();
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_approved()
     OR NOT public.is_shop_admin()
     OR v_shop_id IS NULL THEN
    RAISE EXCEPTION 'Доступ к отчётам запрещён' USING errcode = '42501';
  END IF;

  IF _from IS NULL OR _to IS NULL OR _to <= _from THEN
    RAISE EXCEPTION 'Неверный диапазон дат' USING errcode = '22023';
  END IF;

  -- The UI's end date is inclusive, so its [from, to) window can be one
  -- calendar day longer than the exact five-year date difference.
  IF _to - _from > interval '5 years' + interval '1 day' THEN
    RAISE EXCEPTION 'Диапазон отчёта не должен превышать 5 лет' USING errcode = '22023';
  END IF;

  RETURN QUERY
  WITH bounds AS (
    SELECT
      (_from AT TIME ZONE 'Asia/Bishkek')::date AS first_day,
      ((_to - interval '1 microsecond') AT TIME ZONE 'Asia/Bishkek')::date AS last_day
  ),
  days AS (
    SELECT generated.day::date AS day
    FROM bounds
    CROSS JOIN LATERAL generate_series(
      bounds.first_day::timestamp,
      bounds.last_day::timestamp,
      interval '1 day'
    ) AS generated(day)
  ),
  sales_by_day AS (
    SELECT
      (s.created_at AT TIME ZONE 'Asia/Bishkek')::date AS day,
      COALESCE(SUM(s.total), 0)::numeric AS sales_revenue,
      COALESCE(SUM(s.cost_total), 0)::numeric AS sales_cost,
      COALESCE(SUM(s.profit), 0)::numeric AS sales_profit,
      COUNT(*)::bigint AS sales_count
    FROM public.sales AS s
    WHERE s.shop_id = v_shop_id
      AND s.deleted_at IS NULL
      AND s.created_at >= _from
      AND s.created_at < _to
    GROUP BY 1
  ),
  returns_by_day AS (
    SELECT
      (r.created_at AT TIME ZONE 'Asia/Bishkek')::date AS day,
      COALESCE(SUM(r.amount), 0)::numeric AS refund_amount,
      COALESCE(SUM(r.cost), 0)::numeric AS refund_cost,
      COUNT(*)::bigint AS return_count
    FROM public.sale_returns AS r
    WHERE r.shop_id = v_shop_id
      AND r.deleted_at IS NULL
      AND r.created_at >= _from
      AND r.created_at < _to
    GROUP BY 1
  )
  SELECT
    d.day,
    COALESCE(s.sales_revenue, 0) - COALESCE(r.refund_amount, 0),
    COALESCE(s.sales_cost, 0) - COALESCE(r.refund_cost, 0),
    COALESCE(s.sales_profit, 0) - (COALESCE(r.refund_amount, 0) - COALESCE(r.refund_cost, 0)),
    COALESCE(s.sales_count, 0),
    COALESCE(r.refund_amount, 0),
    COALESCE(r.refund_cost, 0),
    COALESCE(r.return_count, 0)
  FROM days AS d
  LEFT JOIN sales_by_day AS s ON s.day = d.day
  LEFT JOIN returns_by_day AS r ON r.day = d.day
  ORDER BY d.day;
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_sales_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_sales_summary(timestamptz, timestamptz) TO authenticated;
