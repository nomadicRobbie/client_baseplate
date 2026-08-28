-- Reset commerce products for clean slate (DB destination change)
TRUNCATE commerce_product_variants, commerce_products RESTART IDENTITY CASCADE;
