insert into categories (type, slug, name) values
  ('product', 'food', 'Food'),
  ('product', 'sports_equipment', 'Sports Equipment'),
  ('product', 'musical_instruments', 'Musical Instruments'),
  ('product', 'home_equipment', 'Home Equipment & Furniture'),
  ('service', 'bus_rental', 'Bus Rental'),
  ('service', 'tech_development', 'Tech Development'),
  ('service', 'business_consulting', 'Business Consulting')
on conflict (slug) do nothing;

insert into catalog_items (client_id, category_id, name, description, price, unit, sku)
select 3, c.id, v.name, v.description, v.price, v.unit, v.sku
from (values
  ('food', 'Artisan Sourdough Bread', 'Freshly baked daily, 900g loaf', 4.50, 'unit', 'FOOD-001'),
  ('food', 'Organic Olive Oil 1L', 'Cold-pressed extra virgin, Alentejo', 12.90, 'unit', 'FOOD-002'),
  ('food', 'Cured Chorizo Pack', '250g, mild spice', 6.75, 'pack', 'FOOD-003'),
  ('food', 'Mixed Nuts 500g', 'Roasted and salted', 8.20, 'pack', 'FOOD-004'),

  ('sports_equipment', 'Yoga Mat Pro', '6mm non-slip, includes carry strap', 29.99, 'unit', 'SPORT-001'),
  ('sports_equipment', 'Adjustable Dumbbell Set', '2x 5-25kg adjustable dumbbells', 189.00, 'set', 'SPORT-002'),
  ('sports_equipment', 'Football Size 5', 'Match-quality, all-weather', 24.50, 'unit', 'SPORT-003'),
  ('sports_equipment', 'Tennis Racket Carbon', 'Intermediate level, 270g', 79.00, 'unit', 'SPORT-004'),

  ('musical_instruments', 'Acoustic Guitar Steel-String', 'Full size, spruce top, includes gig bag', 149.00, 'unit', 'MUS-001'),
  ('musical_instruments', 'Digital Piano 88-Key', 'Weighted keys, includes stand', 499.00, 'unit', 'MUS-002'),
  ('musical_instruments', 'Beginner Violin 4/4', 'Includes bow, rosin, and case', 119.00, 'unit', 'MUS-003'),
  ('musical_instruments', 'Cajon Percussion Box', 'Handmade birch wood', 89.00, 'unit', 'MUS-004'),

  ('home_equipment', 'Ergonomic Office Chair', 'Mesh back, adjustable lumbar support', 219.00, 'unit', 'HOME-001'),
  ('home_equipment', 'Oak Dining Table 6-Seat', 'Solid oak, seats 6', 649.00, 'unit', 'HOME-002'),
  ('home_equipment', 'Cordless Vacuum Cleaner', '45-minute runtime, HEPA filter', 179.00, 'unit', 'HOME-003'),
  ('home_equipment', '3-Seat Sofa', 'Grey linen upholstery', 899.00, 'unit', 'HOME-004'),

  ('bus_rental', 'Minibus Rental (16 seats)', 'Per day, driver included, up to 200km', 280.00, 'day', 'SVC-BUS-001'),
  ('bus_rental', 'Coach Rental (50 seats)', 'Per day, driver included, up to 300km', 620.00, 'day', 'SVC-BUS-002'),
  ('bus_rental', 'Airport Transfer Shuttle', 'One-way, up to 8 passengers', 65.00, 'trip', 'SVC-BUS-003'),

  ('tech_development', 'Landing Page Build', 'Single-page site, up to 5 sections', 750.00, 'project', 'SVC-TECH-001'),
  ('tech_development', 'Custom Web App (MVP)', 'Scoped MVP build, 4-6 week estimate', 6500.00, 'project', 'SVC-TECH-002'),
  ('tech_development', 'API Integration', 'Third-party API integration, per integration', 1200.00, 'project', 'SVC-TECH-003'),

  ('business_consulting', 'Process Automation Audit', 'Half-day audit + report', 450.00, 'engagement', 'SVC-CONS-001'),
  ('business_consulting', 'Strategy Workshop (Full Day)', 'On-site or remote, up to 8 participants', 900.00, 'day', 'SVC-CONS-002'),
  ('business_consulting', 'Ongoing Advisory Retainer', 'Monthly retainer, 10 hours/month', 1500.00, 'month', 'SVC-CONS-003')
) as v(category_slug, name, description, price, unit, sku)
join categories c on c.slug = v.category_slug
on conflict (sku) do nothing;
