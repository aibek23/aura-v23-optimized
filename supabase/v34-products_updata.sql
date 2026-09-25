-- 1. Добавляем колонку updated_at в таблицу products
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Заполняем существующие строки значением из created_at (или NOW())
UPDATE products 
SET updated_at = created_at 
WHERE updated_at IS NULL;

-- 3. (Опционально) Создаем триггер для автоматического обновления updated_at при UPDATE
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();