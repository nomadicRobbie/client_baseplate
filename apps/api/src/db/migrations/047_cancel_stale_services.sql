-- Cancel past draft/planned services that were never completed or cancelled.
-- These linger in the roster view while being invisible in the schedule (which
-- only shows today/upcoming). Runs cancelService logic in SQL so the roster
-- clean-up (roster_shifts delete, service_assignments soft-remove) follows.

UPDATE scheduled_services
   SET status             = 'cancelled',
       cancellation_reason = 'auto-cancelled: service ended without being completed',
       updated_at         = now()
 WHERE ends_at < now()
   AND status IN ('draft', 'planned');

-- Remove draft roster staging for those services.
DELETE FROM roster_shifts rs
 USING scheduled_services s
 WHERE rs.service_id = s.id
   AND s.status = 'cancelled'
   AND s.cancellation_reason = 'auto-cancelled: service ended without being completed';

-- Soft-remove any live person assignments from published rosters.
UPDATE service_assignments sa
   SET removed_at = now()
  FROM scheduled_services s
 WHERE sa.service_id = s.id
   AND sa.subject_type = 'person'
   AND sa.removed_at IS NULL
   AND s.status = 'cancelled'
   AND s.cancellation_reason = 'auto-cancelled: service ended without being completed';
