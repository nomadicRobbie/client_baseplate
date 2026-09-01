-- Standardise Marine vessels roles to: Skipper, Crew, Assignee.
-- Remap existing asset_assignments that reference the old names.

UPDATE asset_types
   SET roles = ARRAY['Skipper', 'Crew', 'Assignee']
 WHERE name = 'Marine vessels';

UPDATE asset_assignments
   SET role = 'Skipper'
 WHERE role IN ('Captain', 'captain')
   AND asset_id IN (SELECT a.id FROM assets a JOIN asset_types t ON t.id = a.asset_type_id WHERE t.name = 'Marine vessels');

UPDATE asset_assignments
   SET role = 'Crew'
 WHERE role IN ('First Mate', 'Engineer', 'Observer', 'crew')
   AND asset_id IN (SELECT a.id FROM assets a JOIN asset_types t ON t.id = a.asset_type_id WHERE t.name = 'Marine vessels');

-- Any scheduled_services.required_roles or roster_shifts.role referencing old names.
UPDATE scheduled_services
   SET required_roles = (
     SELECT jsonb_agg(
       CASE
         WHEN elem->>'role' IN ('Captain', 'captain') THEN jsonb_set(elem, '{role}', '"Skipper"')
         WHEN elem->>'role' IN ('First Mate', 'Engineer', 'Observer') THEN jsonb_set(elem, '{role}', '"Crew"')
         ELSE elem
       END
     )
     FROM jsonb_array_elements(required_roles::jsonb) elem
   )
 WHERE required_roles::text <> '[]'
   AND required_roles::text ~* 'Captain|First Mate|Engineer|Observer';

UPDATE roster_shifts
   SET role = 'Skipper'
 WHERE role IN ('Captain', 'captain');

UPDATE roster_shifts
   SET role = 'Crew'
 WHERE role IN ('First Mate', 'Engineer', 'Observer');
