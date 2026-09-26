-- English content for the Montréal seed. One row per locale — never title_fr/title_en
-- columns (docs/alentour/04-data-model.md). Loaded after montreal.sql (alphabetical order).
INSERT INTO activity_content (activity_id, locale, title, summary, description, what_to_bring, source) VALUES
 ('b0000001-0000-4000-8000-000000000001','en-CA','Bouldering at Allez Up','Bouldering inside an old sugar silo','One of the best bouldering gyms in Québec, built into the Redpath refinery silos. Problems are reset every week.','Loose clothes. Shoe rental on site.','owner'),
 ('b0000001-0000-4000-8000-000000000002','en-CA','Kondiaronk Lookout','The downtown view, for free','A 20-minute climb from Peel to the chalet. The best view on the island, especially an hour before sunset.','Comfortable shoes, water.','community'),
 ('b0000001-0000-4000-8000-000000000003','en-CA','Improv at Le Randolph','Improv match, no reservation','Improv nights in a board-game pub. The kind of place you arrive alone and leave with people.',NULL,'owner'),
 ('b0000001-0000-4000-8000-000000000004','en-CA','Bota Bota thermal circuit','Nordic spa on a boat','Hot, cold and rest on a converted ferry moored in the Old Port. Silence is mandatory, which is the whole point.','Swimsuit, sandals.','owner'),
 ('b0000001-0000-4000-8000-000000000005','en-CA','Jean-Talon Market','The biggest public market','Produce, cheese, spices. Free to wander, dangerous for your wallet.','A reusable bag.','community'),
 ('b0000001-0000-4000-8000-000000000006','en-CA','MMFA collection','Free entry to the permanent collection','The permanent collection is always free; only temporary exhibitions are paid.',NULL,'owner'),
 ('b0000001-0000-4000-8000-000000000007','en-CA','Skating at La Fontaine','Refrigerated rink, free','Outdoor rink lit at night, with a heated chalet. Skate rental on site.','Skates, or $12 rental.','community'),
 ('b0000001-0000-4000-8000-000000000008','en-CA','Paint-your-own ceramics','Pick a piece and paint it','Choose a piece, paint it, pick it up a week later. Surprisingly good for a first date.',NULL,'owner'),
 ('b0000001-0000-4000-8000-000000000009','en-CA','Cycling the Lachine Canal','14 km of waterside path','A flat, continuous path from the Old Port to Lachine. Bixi docks at both ends.','A bike or a Bixi.','community'),
 ('b0000001-0000-4000-8000-00000000000a','en-CA','Escape room','One hour, one puzzle, one team','Rooms for 2 to 6 people. Pick the beginner room if it is your first time.',NULL,'owner')
ON CONFLICT DO NOTHING;
