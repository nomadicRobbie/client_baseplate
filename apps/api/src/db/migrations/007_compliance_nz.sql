-- NZ Food Control Plan (FCP) "Simply Safe & Suitable" record types.
-- Seed data only — the engine that renders these and checks critical_limit is
-- jurisdiction-agnostic. Australia (etc.) would be a sibling 0NN_compliance_au.sql.
--
-- critical_limit vocabulary (interpreted by the Phase-3 validation engine):
--   {field, op, value}                 single rule
--   {all:[rule,...]} / {any:[rule,...]} combinators
--   op: lte|gte|gt|lt|eq|is_true        compare data[field]
--   op: time_temp                       {temp_field,time_field,value:[[°C,min],...]}
-- ON CONFLICT DO UPDATE so re-seeding (new template version) is idempotent.

INSERT INTO compliance_record_types
  (jurisdiction, code, label, category, tiers, frequency, mandatory, field_schema, critical_limit, sort_order)
VALUES
('NZ','business_profile','Business & plan set-up','setup','{FCP}','reference',true,
 '[{"key":"legal_name","label":"Legal name","type":"text","required":true},
   {"key":"trading_name","label":"Trading name","type":"text"},
   {"key":"activity_type","label":"Activity type","type":"multiselect","options":["Eat-in","Takeaway","On-site catering","Off-site catering","Butcher","Delicatessen","Bakery","Fishmonger","Fresh produce","Supermarket","Mobile","Transport/logistics","Importer","Other"]},
   {"key":"physical_address","label":"Physical address / site(s)","type":"text"},
   {"key":"operator_name","label":"Operator name","type":"text"},
   {"key":"manager_name","label":"Day-to-day manager & position","type":"text"},
   {"key":"plan_version","label":"Plan version in use","type":"text"},
   {"key":"registration_authority","label":"Registration authority","type":"text"},
   {"key":"registration_number","label":"Registration number","type":"text"}]'::jsonb, NULL, 0),

('NZ','staff_training','Staff training','people','{FCP,NP1,NP2,NP3}','on_change',true,
 '[{"key":"staff_name","label":"Staff / visitor name","type":"text","required":true},
   {"key":"role","label":"Role","type":"text"},
   {"key":"topics","label":"Training topics","type":"multiselect","options":["High-risk foods","Safe sourcing/receiving","Hand-washing/hygiene","Allergen management","Keeping raw away from cooked","Cleaning & sanitising","What to do when something goes wrong","Food recalls"]},
   {"key":"date_trained","label":"Date trained","type":"date"},
   {"key":"trained_by","label":"Trained by","type":"text"},
   {"key":"competency_confirmed","label":"Competency confirmed","type":"bool"}]'::jsonb,
 '{"field":"competency_confirmed","op":"is_true"}'::jsonb, 10),

('NZ','fridge_temp','Fridge / chilled temperature check','temperature','{FCP,NP1,NP2,NP3}','daily',true,
 '[{"key":"unit_id","label":"Unit / fridge ID","type":"text","required":true},
   {"key":"item_checked","label":"Item or unit checked","type":"text"},
   {"key":"temp_c","label":"Temperature","type":"number","unit":"°C","required":true},
   {"key":"method","label":"Method","type":"enum","options":["Calibrated probe","Infrared","Automated (bluetooth)"]}]'::jsonb,
 '{"field":"temp_c","op":"lte","value":5}'::jsonb, 20),

('NZ','freezer_check','Freezer frozen-solid check','temperature','{FCP,NP1,NP2,NP3}','daily',true,
 '[{"key":"unit_id","label":"Freezer ID","type":"text","required":true},
   {"key":"frozen_solid","label":"Food still frozen solid","type":"bool","required":true}]'::jsonb,
 '{"field":"frozen_solid","op":"is_true"}'::jsonb, 21),

('NZ','cooking_poultry_mince_liver','Cooking — poultry, mince, liver','cooking','{FCP,NP2,NP3}','per_batch',true,
 '[{"key":"product","label":"Food / product","type":"text","required":true},
   {"key":"temp_c","label":"Internal temp reached","type":"number","unit":"°C","required":true},
   {"key":"minutes","label":"Time held at that temp","type":"number","unit":"min","required":true},
   {"key":"method","label":"Method","type":"enum","options":["Probe","Infrared","Automated"]}]'::jsonb,
 '{"op":"time_temp","temp_field":"temp_c","time_field":"minutes","value":[[65,15],[70,3],[75,0.5]]}'::jsonb, 30),

('NZ','cooking_general','Cooking — general (thoroughly cooked)','cooking','{FCP}','per_batch',false,
 '[{"key":"product","label":"Food / product","type":"text","required":true},
   {"key":"temp_c","label":"Internal temp reached","type":"number","unit":"°C"},
   {"key":"method","label":"Method","type":"enum","options":["Probe","Infrared","Automated"]}]'::jsonb,
 '{"field":"temp_c","op":"gte","value":75}'::jsonb, 31),

('NZ','cooling','Cooling freshly cooked food','cooling','{FCP,NP2,NP3}','per_batch',true,
 '[{"key":"food","label":"Food","type":"text","required":true},
   {"key":"total_hours","label":"Total time to cool (60→5°C)","type":"number","unit":"hrs","required":true},
   {"key":"method","label":"Method","type":"multiselect","options":["Shallow containers","Ice bath","Smaller portions","Cooling racks","Blast chiller"]}]'::jsonb,
 '{"field":"total_hours","op":"lte","value":6}'::jsonb, 40),

('NZ','reheating','Reheating food','temperature','{FCP}','per_batch',false,
 '[{"key":"food","label":"Food","type":"text","required":true},
   {"key":"temp_c","label":"Temp reached (coolest part)","type":"number","unit":"°C","required":true},
   {"key":"equipment","label":"Equipment","type":"enum","options":["Microwave","Stovetop","Oven","Other"]}]'::jsonb,
 '{"field":"temp_c","op":"gte","value":75}'::jsonb, 41),

('NZ','hot_holding','Keeping food hot (hot-holding)','temperature','{FCP}','periodic',false,
 '[{"key":"food","label":"Food","type":"text","required":true},
   {"key":"temp_c","label":"Temperature","type":"number","unit":"°C","required":true}]'::jsonb,
 '{"field":"temp_c","op":"gt","value":60}'::jsonb, 42),

('NZ','receiving','Sourcing / receiving food','receiving','{FCP,NP1,NP2,NP3}','per_delivery',true,
 '[{"key":"supplier","label":"Supplier","type":"text","required":true},
   {"key":"food","label":"Food type & quantity","type":"text"},
   {"key":"temp_c","label":"Temperature on receipt (if temp-controlled)","type":"number","unit":"°C"},
   {"key":"use_by_ok","label":"Use-By checked / not expired","type":"bool"},
   {"key":"packaging_ok","label":"Packaging intact / not contaminated","type":"bool"},
   {"key":"rejected","label":"Rejected?","type":"bool"},
   {"key":"reject_reason","label":"Reason if rejected","type":"text"}]'::jsonb,
 '{"all":[{"field":"use_by_ok","op":"is_true"},{"field":"packaging_ok","op":"is_true"}]}'::jsonb, 50),

('NZ','supply_to_business','Selling to other businesses (traceability)','traceability','{FCP}','per_incident',false,
 '[{"key":"business_supplied","label":"Business supplied (name & contact)","type":"text","required":true},
   {"key":"product","label":"Product supplied","type":"text"},
   {"key":"amount","label":"Amount","type":"number"},
   {"key":"date_supplied","label":"Date supplied","type":"date"}]'::jsonb, NULL, 60),

('NZ','cleaning_close','Cleaning & sanitising / end-of-day close','cleaning','{FCP}','daily',false,
 '[{"key":"area","label":"Area / equipment","type":"text","required":true},
   {"key":"cleaned_sanitised","label":"Cleaned & sanitised","type":"bool","required":true},
   {"key":"stock_check_done","label":"End-of-day stock check (expired/contaminated removed)","type":"bool"},
   {"key":"done_by","label":"Done by","type":"text"}]'::jsonb,
 '{"field":"cleaned_sanitised","op":"is_true"}'::jsonb, 70),

('NZ','maintenance_calibration','Maintenance & thermometer calibration','maintenance','{FCP}','periodic',false,
 '[{"key":"equipment","label":"Equipment / facility","type":"text","required":true},
   {"key":"date_checked","label":"Date checked / serviced","type":"date"},
   {"key":"issue_action","label":"Issue found / action","type":"text"},
   {"key":"thermometer_calibrated","label":"Thermometer calibrated (accurate)","type":"bool"},
   {"key":"calibration_result","label":"Calibration result","type":"number","unit":"°C"}]'::jsonb,
 '{"field":"thermometer_calibrated","op":"is_true"}'::jsonb, 80),

('NZ','staff_sickness','Staff health / sickness','people','{FCP,NP1,NP2,NP3}','per_incident',true,
 '[{"key":"staff_name","label":"Staff name","type":"text","required":true},
   {"key":"date_reported","label":"Date reported sick","type":"date"},
   {"key":"symptom","label":"Symptom type","type":"enum","options":["Vomiting","Diarrhoea","Jaundice","Other"]},
   {"key":"excluded","label":"Excluded from food handling","type":"bool"},
   {"key":"return_date","label":"Return-to-work date","type":"date"}]'::jsonb,
 '{"field":"excluded","op":"is_true"}'::jsonb, 90),

('NZ','allergen_recipe','Allergens / knowing what''s in your food','allergens','{FCP}','on_change',false,
 '[{"key":"dish","label":"Dish / product","type":"text","required":true},
   {"key":"ingredients","label":"Ingredients & recipe","type":"text"},
   {"key":"allergens","label":"Allergens present","type":"multiselect","options":["Peanuts","Tree nuts","Crustacea","Molluscs","Fish","Milk","Egg","Gluten","Wheat","Soy","Sesame","Lupin","Sulphites"]},
   {"key":"nominated_person","label":"Nominated person for allergen queries","type":"text"}]'::jsonb, NULL, 100),

('NZ','labelling','Packaging & labelling','labelling','{FCP}','per_incident',false,
 '[{"key":"product","label":"Product","type":"text","required":true},
   {"key":"lot_batch_id","label":"Lot / batch ID","type":"text"},
   {"key":"label_elements","label":"Label elements held","type":"multiselect","options":["Name of food","Business name & address","Allergen declarations","Storage & use conditions","Ingredients list","Date marking","Nutrition panel","Health claims"]},
   {"key":"shelf_life_basis","label":"How shelf-life / date mark calculated","type":"text"}]'::jsonb, NULL, 110),

('NZ','transport','Transporting food','transport','{FCP}','per_incident',false,
 '[{"key":"food","label":"Food","type":"text","required":true},
   {"key":"temp_c","label":"Transport temperature","type":"number","unit":"°C","required":true},
   {"key":"equipment","label":"Equipment","type":"enum","options":["Insulated bags/boxes","Portable chillers","Hot-holding","Other"]},
   {"key":"vehicle_cleaned","label":"Vehicle cleaned/sanitised (if RTE contact)","type":"bool"}]'::jsonb,
 '{"any":[{"field":"temp_c","op":"lte","value":5},{"field":"temp_c","op":"gt","value":60}]}'::jsonb, 120),

('NZ','display_selfservice','Displaying food / self-service','display','{FCP}','periodic',false,
 '[{"key":"item","label":"Item on display","type":"text","required":true},
   {"key":"use_by_ok","label":"Use-By checked on display","type":"bool"},
   {"key":"protection_ok","label":"Protected (sneeze guard / pre-wrap / dedicated utensils)","type":"bool"}]'::jsonb,
 '{"all":[{"field":"use_by_ok","op":"is_true"},{"field":"protection_ok","op":"is_true"}]}'::jsonb, 130),

('NZ','self_supply_water','Self-supply water test','water','{FCP,NP1,NP2,NP3}','on_change',false,
 '[{"key":"test_date","label":"Test date","type":"date","required":true},
   {"key":"ecoli","label":"E. coli (per 100 mL)","type":"number","required":true},
   {"key":"turbidity_ntu","label":"Turbidity","type":"number","unit":"NTU"},
   {"key":"chlorine_mgl","label":"Free available chlorine (if chlorinated)","type":"number","unit":"mg/L"},
   {"key":"ph","label":"pH (if chlorinated)","type":"number"},
   {"key":"action_if_failed","label":"Action taken if a test failed","type":"text"}]'::jsonb,
 '{"all":[{"field":"ecoli","op":"lt","value":1},{"field":"turbidity_ntu","op":"lte","value":5}]}'::jsonb, 140),

('NZ','corrective_action','When something goes wrong (corrective action)','incident','{FCP,NP1,NP2,NP3}','per_incident',true,
 '[{"key":"what_went_wrong","label":"What went wrong","type":"text","required":true},
   {"key":"affected","label":"Food / equipment affected","type":"text"},
   {"key":"action_taken","label":"What was done with the food","type":"text"},
   {"key":"cause","label":"Cause","type":"text"},
   {"key":"prevention","label":"Action to prevent recurrence","type":"text"}]'::jsonb, NULL, 200),

('NZ','recall','Food recall (or mock recall)','incident','{FCP,NP1,NP2,NP3}','per_incident',true,
 '[{"key":"product_batch","label":"Product & batch/lot affected","type":"text","required":true},
   {"key":"reason","label":"Reason","type":"text"},
   {"key":"quantity","label":"Quantity affected / recovered","type":"number"},
   {"key":"notified_customers","label":"Customers/businesses notified","type":"text"},
   {"key":"notified_mpi","label":"MPI / council notified","type":"bool"},
   {"key":"outcome","label":"Outcome & corrective action","type":"text"}]'::jsonb, NULL, 210),

('NZ','self_verification_check','Internal self-check (plan working well)','verification','{FCP}','periodic',true,
 '[{"key":"who","label":"Who did the check","type":"text","required":true},
   {"key":"areas_reviewed","label":"Areas reviewed","type":"multiselect","options":["Records complete","Procedures followed","Staff competent"]},
   {"key":"issues_found","label":"Issues found","type":"text"},
   {"key":"actions_taken","label":"Actions taken","type":"text"}]'::jsonb, NULL, 220)

ON CONFLICT (jurisdiction, code) DO UPDATE SET
  label = EXCLUDED.label, category = EXCLUDED.category, tiers = EXCLUDED.tiers,
  frequency = EXCLUDED.frequency, mandatory = EXCLUDED.mandatory,
  field_schema = EXCLUDED.field_schema, critical_limit = EXCLUDED.critical_limit,
  sort_order = EXCLUDED.sort_order;
