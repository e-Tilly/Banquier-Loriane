-- Seed: a first slice of the Plateau / Mile End catalog.
--
-- Real places, approximate coordinates. This exists so `npm run catalog:export` produces
-- something on a fresh clone, and as the shape to copy when you hand-curate the first 300
-- (docs/alentour/13-risks-and-open-questions.md, step 2).
--
-- NOTE: prices and hours drift. Anything here is a starting point to verify in person,
-- which is exactly the walk described in the plan.

BEGIN;

INSERT INTO tags (slug, facet, label_i18n, is_tristate, ai_may_assert) VALUES
  ('category.sports','category','{"fr-CA":"Sport","en-CA":"Sports"}',false,true),
  ('category.arts','category','{"fr-CA":"Arts et culture","en-CA":"Arts & culture"}',false,true),
  ('category.outdoors','category','{"fr-CA":"Plein air","en-CA":"Outdoors"}',false,true),
  ('category.games','category','{"fr-CA":"Jeux","en-CA":"Games"}',false,true),
  ('category.food','category','{"fr-CA":"Manger et boire","en-CA":"Food & drink"}',false,true),
  ('category.wellness','category','{"fr-CA":"Bien-être","en-CA":"Wellness"}',false,true),
  ('category.learning','category','{"fr-CA":"Ateliers","en-CA":"Workshops"}',false,true),
  ('category.markets','category','{"fr-CA":"Marchés","en-CA":"Markets"}',false,true),
  ('vibe.chill','vibe','{"fr-CA":"Relax","en-CA":"Chill"}',false,true),
  ('vibe.social','vibe','{"fr-CA":"Pour rencontrer du monde","en-CA":"Meet people"}',false,true),
  ('vibe.first_date','vibe','{"fr-CA":"Premier date","en-CA":"First date"}',false,true),
  ('vibe.get_moving','vibe','{"fr-CA":"Bouger","en-CA":"Get moving"}',false,true),
  ('vibe.creative','vibe','{"fr-CA":"Créatif","en-CA":"Creative"}',false,true),
  ('vibe.rainy_day','vibe','{"fr-CA":"Jour de pluie","en-CA":"Rainy day"}',false,true),
  ('vibe.cheap_thrill','vibe','{"fr-CA":"Pas cher et le fun","en-CA":"Cheap thrill"}',false,true),
  ('vibe.awe','vibe','{"fr-CA":"À couper le souffle","en-CA":"Awe"}',false,true),
  ('vibe.cozy','vibe','{"fr-CA":"Cocooning","en-CA":"Cozy"}',false,true),
  ('vibe.solo_recharge','vibe','{"fr-CA":"Recharger seul","en-CA":"Solo recharge"}',false,true),
  ('audience.beginners_welcome','audience','{"fr-CA":"Débutants bienvenus","en-CA":"Beginners welcome"}',false,true),
  ('audience.students','audience','{"fr-CA":"Rabais étudiant","en-CA":"Student discount"}',false,true),
  ('logistics.transit_nearby','logistics','{"fr-CA":"Proche du métro","en-CA":"Near transit"}',false,true),
  ('logistics.equipment_provided','logistics','{"fr-CA":"Équipement fourni","en-CA":"Equipment provided"}',false,true),
  ('logistics.equipment_extra_cost','logistics','{"fr-CA":"Location en sus","en-CA":"Rental costs extra"}',false,true),
  ('logistics.late_hours','logistics','{"fr-CA":"Ouvert tard","en-CA":"Open late"}',false,true),
  ('logistics.alcohol_served','logistics','{"fr-CA":"Alcool servi","en-CA":"Alcohol served"}',false,true),
  ('group.solo_friendly','group','{"fr-CA":"Bien seul","en-CA":"Good solo"}',false,true),
  ('group.small_group','group','{"fr-CA":"Petit groupe","en-CA":"Small group"}',false,true),
  ('weather.requires_daylight','weather','{"fr-CA":"Lumière du jour","en-CA":"Needs daylight"}',false,true),
  -- accessibility: tri-state, and the AI may never assert these
  ('a11y.step_free_entry','accessibility','{"fr-CA":"Entrée sans marche","en-CA":"Step-free entry"}',true,false),
  ('a11y.accessible_washroom','accessibility','{"fr-CA":"Toilette accessible","en-CA":"Accessible washroom"}',true,false),
  ('a11y.seating_available','accessibility','{"fr-CA":"Places assises","en-CA":"Seating available"}',true,false)
ON CONFLICT (slug) DO NOTHING;

-- venues -----------------------------------------------------------------
INSERT INTO venues (id, name, lat, lon, neighbourhood, timezone, address) VALUES
 ('a0000001-0000-4000-8000-000000000001','Allez Up',45.4795,-73.5665,'Sud-Ouest','America/Toronto','{"line1":"1555 Rue Saint-Patrick"}'),
 ('a0000001-0000-4000-8000-000000000002','Parc du Mont-Royal',45.5048,-73.5878,'Plateau','America/Toronto','{"line1":"1260 Ch. Remembrance"}'),
 ('a0000001-0000-4000-8000-000000000003','Le Randolph',45.5237,-73.5817,'Plateau','America/Toronto','{"line1":"2041 Rue Saint-Denis"}'),
 ('a0000001-0000-4000-8000-000000000004','Bota Bota',45.4995,-73.5530,'Vieux-Port','America/Toronto','{"line1":"Rue de la Commune O"}'),
 ('a0000001-0000-4000-8000-000000000005','Marché Jean-Talon',45.5360,-73.6145,'Petite-Italie','America/Toronto','{"line1":"7070 Av. Henri-Julien"}'),
 ('a0000001-0000-4000-8000-000000000006','Musée des beaux-arts',45.4986,-73.5795,'Centre-ville','America/Toronto','{"line1":"1380 Rue Sherbrooke O"}'),
 ('a0000001-0000-4000-8000-000000000007','Parc La Fontaine',45.5270,-73.5700,'Plateau','America/Toronto','{"line1":"3819 Av. Calixa-Lavallée"}'),
 ('a0000001-0000-4000-8000-000000000008','Céramic Café',45.5232,-73.5952,'Mile End','America/Toronto','{"line1":"4338 Rue Saint-Denis"}'),
 ('a0000001-0000-4000-8000-000000000009','Canal de Lachine',45.4760,-73.5800,'Sud-Ouest','America/Toronto','{"line1":"Canal de Lachine"}'),
 ('a0000001-0000-4000-8000-00000000000a','Lab Escape',45.5195,-73.5720,'Plateau','America/Toronto','{"line1":"1751 Rue Richardson"}')
ON CONFLICT (id) DO NOTHING;

-- activities -------------------------------------------------------------
-- (id, slug, kind, category, price, duration, effort, months, weather, hours, quality)
INSERT INTO activities
 (id, slug, kind, status, primary_category, price_min_cents, price_max_cents, price_unit,
  is_free, duration_min_minutes, duration_max_minutes, typical_duration_minutes,
  physical_demand, skill_required, risk_tier, icebreaker_score, months_open, best_months,
  weather_dependency, opening_hours, min_age, quality_score, completeness, taxonomy_version,
  last_verified_at)
VALUES
 ('b0000001-0000-4000-8000-000000000001','bloc-allez-up','place','published','category.sports',
  2600,3400,'per_person',false,60,180,120,3,1,1,2,4095,NULL,'indoor',
  'Mo-Fr 06:00-23:00; Sa-Su 08:00-21:00',NULL,0.88,0.9,1,now()),
 ('b0000001-0000-4000-8000-000000000002','mont-royal-belvedere','self_guided','published','category.outdoors',
  NULL,NULL,NULL,true,45,120,75,2,0,0,1,4095,1008,'outdoor','24/7',NULL,0.95,0.85,1,now()),
 ('b0000001-0000-4000-8000-000000000003','impro-randolph','recurring_program','published','category.games',
  1000,1800,'per_person',false,90,180,120,0,0,0,2,4095,NULL,'indoor',
  'We-Su 17:00-01:00',18,0.72,0.8,1,now()),
 ('b0000001-0000-4000-8000-000000000004','bota-bota-thermal','place','published','category.wellness',
  6500,9500,'per_person',false,120,240,180,0,0,0,0,4095,NULL,'covered',
  'Mo-Su 09:00-22:00',18,0.9,0.95,1,now()),
 ('b0000001-0000-4000-8000-000000000005','marche-jean-talon','place','published','category.markets',
  NULL,NULL,NULL,true,45,120,60,1,0,0,1,4095,1008,'covered',
  'Mo-We 08:00-18:00; Th-Fr 08:00-20:00; Sa-Su 08:00-17:00',NULL,0.86,0.8,1,now()),
 ('b0000001-0000-4000-8000-000000000006','mbam-collection','place','published','category.arts',
  0,2400,'per_person',false,60,180,90,1,0,0,1,4095,NULL,'indoor',
  'Tu-Su 10:00-17:00',NULL,0.84,0.9,1,now()),
 ('b0000001-0000-4000-8000-000000000007','patin-lafontaine','seasonal','published','category.outdoors',
  NULL,NULL,NULL,true,45,120,60,2,1,1,2,3079,3,'outdoor',
  'Mo-Su 10:00-22:00',NULL,0.8,0.75,1,now()),
 ('b0000001-0000-4000-8000-000000000008','ceramique-peinture','place','published','category.learning',
  2200,4000,'per_person',false,90,180,120,0,0,0,2,4095,NULL,'indoor',
  'Mo-Su 11:00-21:00',NULL,0.76,0.85,1,now()),
 ('b0000001-0000-4000-8000-000000000009','velo-canal-lachine','self_guided','published','category.outdoors',
  NULL,NULL,NULL,true,60,180,90,2,1,1,1,2040,448,'outdoor','24/7',NULL,0.87,0.8,1,now()),
 ('b0000001-0000-4000-8000-00000000000a','escape-lab','place','published','category.games',
  3200,3800,'per_person',false,60,90,75,1,2,0,2,4095,NULL,'indoor',
  'We-Su 12:00-22:00',NULL,0.79,0.85,1,now())
ON CONFLICT (id) DO NOTHING;

-- content (fr-CA) ---------------------------------------------------------
INSERT INTO activity_content (activity_id, locale, title, summary, description, what_to_bring, source) VALUES
 ('b0000001-0000-4000-8000-000000000001','fr-CA','Bloc à Allez Up','Escalade de bloc dans un ancien silo à sucre','Un des plus beaux centres de bloc au Québec, aménagé dans les silos de la raffinerie Redpath. Les parcours changent chaque semaine.','Vêtements souples. Chaussons en location.','owner'),
 ('b0000001-0000-4000-8000-000000000002','fr-CA','Belvédère Kondiaronk','La vue sur le centre-ville, gratuite','Montée de 20 minutes depuis Peel jusqu''au chalet. Le meilleur point de vue de l''île, surtout une heure avant le coucher du soleil.','Souliers confortables, de l''eau.','community'),
 ('b0000001-0000-4000-8000-000000000003','fr-CA','Impro au Randolph','Match d''improvisation, sans réservation','Soirées d''impro dans un pub à jeux. Le genre d''endroit où on arrive seul et on repart avec du monde.',NULL,'owner'),
 ('b0000001-0000-4000-8000-000000000004','fr-CA','Circuit thermal Bota Bota','Spa nordique sur un bateau','Bains chauds, froids et repos, sur un traversier réaménagé amarré au Vieux-Port. Silence obligatoire, ce qui est tout le charme.','Maillot de bain, sandales.','owner'),
 ('b0000001-0000-4000-8000-000000000005','fr-CA','Marché Jean-Talon','Le plus grand marché public','Produits maraîchers, fromagers, épices. Gratuit à visiter, dangereux pour le portefeuille.','Un sac réutilisable.','community'),
 ('b0000001-0000-4000-8000-000000000006','fr-CA','Collection du MBAM','Entrée gratuite pour la collection permanente','La collection permanente est gratuite en tout temps; seules les expositions temporaires sont payantes.',NULL,'owner'),
 ('b0000001-0000-4000-8000-000000000007','fr-CA','Patin à La Fontaine','Patinoire réfrigérée, gratuite','Patinoire extérieure éclairée le soir, avec chalet chauffé. Location de patins sur place.','Patins, ou 12$ de location.','community'),
 ('b0000001-0000-4000-8000-000000000008','fr-CA','Peinture sur céramique','Choisir une pièce et la peindre','On choisit une pièce, on la peint, on repasse la chercher une semaine plus tard. Marche étonnamment bien pour un premier date.',NULL,'owner'),
 ('b0000001-0000-4000-8000-000000000009','fr-CA','Vélo sur le canal','14 km de piste au bord de l''eau','Piste plate et continue du Vieux-Port jusqu''à Lachine. Bixi disponible aux deux extrémités.','Vélo ou Bixi.','community'),
 ('b0000001-0000-4000-8000-00000000000a','fr-CA','Jeu d''évasion','Une heure, une énigme, une équipe','Salles pour 2 à 6 personnes. Prendre la salle débutant si c''est une première.',NULL,'owner')
ON CONFLICT DO NOTHING;

-- locations (trigger copies lat/lon from the venue) ------------------------
INSERT INTO activity_locations (activity_id, venue_id, is_primary, lat, lon)
SELECT a.id, v.id, true, 0, 0
FROM (VALUES
 ('b0000001-0000-4000-8000-000000000001','a0000001-0000-4000-8000-000000000001'),
 ('b0000001-0000-4000-8000-000000000002','a0000001-0000-4000-8000-000000000002'),
 ('b0000001-0000-4000-8000-000000000003','a0000001-0000-4000-8000-000000000003'),
 ('b0000001-0000-4000-8000-000000000004','a0000001-0000-4000-8000-000000000004'),
 ('b0000001-0000-4000-8000-000000000005','a0000001-0000-4000-8000-000000000005'),
 ('b0000001-0000-4000-8000-000000000006','a0000001-0000-4000-8000-000000000006'),
 ('b0000001-0000-4000-8000-000000000007','a0000001-0000-4000-8000-000000000007'),
 ('b0000001-0000-4000-8000-000000000008','a0000001-0000-4000-8000-000000000008'),
 ('b0000001-0000-4000-8000-000000000009','a0000001-0000-4000-8000-000000000009'),
 ('b0000001-0000-4000-8000-00000000000a','a0000001-0000-4000-8000-00000000000a')
) AS m(aid, vid)
JOIN activities a ON a.id = m.aid::uuid
JOIN venues v     ON v.id = m.vid::uuid
ON CONFLICT DO NOTHING;

-- tags --------------------------------------------------------------------
INSERT INTO activity_tags (activity_id, tag_slug, value, source, confidence) VALUES
 ('b0000001-0000-4000-8000-000000000001','vibe.get_moving',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000001','vibe.social',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000001','audience.beginners_welcome',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000001','logistics.equipment_extra_cost',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000001','group.small_group',true,'ai',0.8),
 ('b0000001-0000-4000-8000-000000000001','a11y.step_free_entry',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000002','vibe.awe',true,'community',0.9),
 ('b0000001-0000-4000-8000-000000000002','vibe.solo_recharge',true,'community',0.9),
 ('b0000001-0000-4000-8000-000000000002','weather.requires_daylight',true,'derived',1),
 ('b0000001-0000-4000-8000-000000000002','group.solo_friendly',true,'community',1),
 ('b0000001-0000-4000-8000-000000000002','a11y.step_free_entry',false,'community',1),
 ('b0000001-0000-4000-8000-000000000003','vibe.social',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000003','logistics.alcohol_served',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000003','logistics.late_hours',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000003','group.solo_friendly',true,'ai',0.7),
 ('b0000001-0000-4000-8000-000000000004','vibe.chill',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000004','vibe.cozy',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000004','vibe.rainy_day',true,'ai',0.9),
 ('b0000001-0000-4000-8000-000000000004','a11y.step_free_entry',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000004','a11y.accessible_washroom',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000005','vibe.chill',true,'community',0.8),
 ('b0000001-0000-4000-8000-000000000005','logistics.transit_nearby',true,'derived',1),
 ('b0000001-0000-4000-8000-000000000005','a11y.step_free_entry',true,'community',0.9),
 ('b0000001-0000-4000-8000-000000000006','vibe.rainy_day',true,'ai',0.9),
 ('b0000001-0000-4000-8000-000000000006','vibe.first_date',true,'community',0.8),
 ('b0000001-0000-4000-8000-000000000006','audience.students',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000006','a11y.step_free_entry',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000006','a11y.accessible_washroom',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000006','a11y.seating_available',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000007','vibe.cheap_thrill',true,'community',0.9),
 ('b0000001-0000-4000-8000-000000000007','vibe.social',true,'community',0.8),
 ('b0000001-0000-4000-8000-000000000008','vibe.creative',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000008','vibe.first_date',true,'community',0.9),
 ('b0000001-0000-4000-8000-000000000008','vibe.rainy_day',true,'ai',0.85),
 ('b0000001-0000-4000-8000-000000000008','logistics.equipment_provided',true,'owner',1),
 ('b0000001-0000-4000-8000-000000000009','vibe.get_moving',true,'community',1),
 ('b0000001-0000-4000-8000-000000000009','group.solo_friendly',true,'community',1),
 ('b0000001-0000-4000-8000-00000000000a','vibe.social',true,'owner',1),
 ('b0000001-0000-4000-8000-00000000000a','group.small_group',true,'owner',1),
 ('b0000001-0000-4000-8000-00000000000a','vibe.rainy_day',true,'ai',0.8)
ON CONFLICT DO NOTHING;

-- websites: what makes the instant email-domain claim possible
UPDATE venues SET website = w.url FROM (VALUES
 ('a0000001-0000-4000-8000-000000000001','https://www.allezup.com'),
 ('a0000001-0000-4000-8000-000000000003','https://lerandolph.com'),
 ('a0000001-0000-4000-8000-000000000004','https://botabota.ca'),
 ('a0000001-0000-4000-8000-000000000006','https://www.mbam.qc.ca'),
 ('a0000001-0000-4000-8000-000000000008','https://www.ceramiccafe.ca'),
 ('a0000001-0000-4000-8000-00000000000a','https://www.labescape.ca')
) AS w(id, url) WHERE venues.id = w.id::uuid;

COMMIT;
