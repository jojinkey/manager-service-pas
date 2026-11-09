-- Run AFTER migration 001 and template seeds. Supabase supports pg_cron.
-- One durable minute job, safe to retry after downtime, no browser dependency.
create extension if not exists pg_cron;
do $$begin
 if not exists(select 1 from cron.job where jobname='restaurant-report-reconciliation') then
  perform cron.schedule('restaurant-report-reconciliation','* * * * *','select public.reconcile_reports()');
 end if;
end$$;
-- Weekly compliance (smoke-test overdue alerts, pest-control weekly flags). Runs with nobody logged in.
do $$begin
 if not exists(select 1 from cron.job where jobname='weekly-compliance-checks') then
  perform cron.schedule('weekly-compliance-checks','*/15 * * * *','select public.run_weekly_checks()');
 end if;
end$$;
