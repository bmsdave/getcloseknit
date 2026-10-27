-- 103: England geography. The 'borough' carrier is any English local authority district
-- (LAD: E06 unitary, E07 district, E08 metropolitan, E09 London borough); the kind name and the
-- id format uk:borough:<code> stay, so no URL changes. Every lsoa/msoa/borough gets its region
-- (E12000001..E12000009) in area_region, and every percentile that was "within London" is now
-- computed within the area's region. London is region E12000007, so London numbers do not change;
-- the stored column names (london_percentile, area_london_rank...) stay for compatibility.
--
-- lad_region     the 296 English LADs (ONS Postcode Directory August 2026, OGL v3): name, region.
-- area_region    area_id -> region_code, region_name for every lsoa/msoa/borough. Filled by the
--                area_region_fill trigger as area_geography rows arrive (parents first, as the
--                hierarchy trigger already demands) and by refresh_area_region() for rows that exist.
-- area_rank_region(area_id)   the region an area ranks in (NULL without a row: such areas rank
--                together, as before); point_rank_region(point) the region of the nearest LAD.
--
-- Functions redefined here differ from their last definition only in the ranking scope
-- (PARTITION BY region): 001 enforce_geography_hierarchy (any English LAD), 054
-- rebuild_area_london_rank, 069 rebuild_area_good_value (peers from the same region), 096
-- rebuild_area_price_bands, 098 rebuild_stock_values, 062 rebuild_area_kids, 064
-- rebuild_area_nature, 080 rebuild_hpi_layers (any LAD), 082 rebuild_council_tax_band, 083
-- load_ownership_metrics, 086 rebuild_area_mobile_metrics, 091 rebuild_area_health, 100
-- rebuild_typical_rent / rebuild_flood_risk / rebuild_good_schools_nearby, 101
-- rebuild_supermarket_walk / rebuild_gp_walk / rebuild_broadband_gigabit. London-only sources
-- (085 development pipeline, 087 HMO) keep their London ranking.
--
-- Idempotent: safe to run again. Apply with psql -1 -v ON_ERROR_STOP=1.

CREATE TABLE IF NOT EXISTS lad_region (
    lad_code text PRIMARY KEY CHECK (lad_code ~ '^E0[6-9][0-9]{6}$'),
    lad_name text NOT NULL,
    region_code text NOT NULL CHECK (region_code ~ '^E1200000[1-9]$'),
    region_name text NOT NULL
);

INSERT INTO lad_region (lad_code, lad_name, region_code, region_name) VALUES
    ('E06000001', 'Hartlepool', 'E12000001', 'North East'),
    ('E06000002', 'Middlesbrough', 'E12000001', 'North East'),
    ('E06000003', 'Redcar and Cleveland', 'E12000001', 'North East'),
    ('E06000004', 'Stockton-on-Tees', 'E12000001', 'North East'),
    ('E06000005', 'Darlington', 'E12000001', 'North East'),
    ('E06000006', 'Halton', 'E12000002', 'North West'),
    ('E06000007', 'Warrington', 'E12000002', 'North West'),
    ('E06000008', 'Blackburn with Darwen', 'E12000002', 'North West'),
    ('E06000009', 'Blackpool', 'E12000002', 'North West'),
    ('E06000010', 'Kingston upon Hull, City of', 'E12000003', 'Yorkshire and The Humber'),
    ('E06000011', 'East Riding of Yorkshire', 'E12000003', 'Yorkshire and The Humber'),
    ('E06000012', 'North East Lincolnshire', 'E12000003', 'Yorkshire and The Humber'),
    ('E06000013', 'North Lincolnshire', 'E12000003', 'Yorkshire and The Humber'),
    ('E06000014', 'York', 'E12000003', 'Yorkshire and The Humber'),
    ('E06000015', 'Derby', 'E12000004', 'East Midlands'),
    ('E06000016', 'Leicester', 'E12000004', 'East Midlands'),
    ('E06000017', 'Rutland', 'E12000004', 'East Midlands'),
    ('E06000018', 'Nottingham', 'E12000004', 'East Midlands'),
    ('E06000019', 'Herefordshire, County of', 'E12000005', 'West Midlands'),
    ('E06000020', 'Telford and Wrekin', 'E12000005', 'West Midlands'),
    ('E06000021', 'Stoke-on-Trent', 'E12000005', 'West Midlands'),
    ('E06000022', 'Bath and North East Somerset', 'E12000009', 'South West'),
    ('E06000023', 'Bristol, City of', 'E12000009', 'South West'),
    ('E06000024', 'North Somerset', 'E12000009', 'South West'),
    ('E06000025', 'South Gloucestershire', 'E12000009', 'South West'),
    ('E06000026', 'Plymouth', 'E12000009', 'South West'),
    ('E06000027', 'Torbay', 'E12000009', 'South West'),
    ('E06000030', 'Swindon', 'E12000009', 'South West'),
    ('E06000031', 'Peterborough', 'E12000006', 'East of England'),
    ('E06000032', 'Luton', 'E12000006', 'East of England'),
    ('E06000033', 'Southend-on-Sea', 'E12000006', 'East of England'),
    ('E06000034', 'Thurrock', 'E12000006', 'East of England'),
    ('E06000035', 'Medway', 'E12000008', 'South East'),
    ('E06000036', 'Bracknell Forest', 'E12000008', 'South East'),
    ('E06000037', 'West Berkshire', 'E12000008', 'South East'),
    ('E06000038', 'Reading', 'E12000008', 'South East'),
    ('E06000039', 'Slough', 'E12000008', 'South East'),
    ('E06000040', 'Windsor and Maidenhead', 'E12000008', 'South East'),
    ('E06000041', 'Wokingham', 'E12000008', 'South East'),
    ('E06000042', 'Milton Keynes', 'E12000008', 'South East'),
    ('E06000043', 'Brighton and Hove', 'E12000008', 'South East'),
    ('E06000044', 'Portsmouth', 'E12000008', 'South East'),
    ('E06000045', 'Southampton', 'E12000008', 'South East'),
    ('E06000046', 'Isle of Wight', 'E12000008', 'South East'),
    ('E06000047', 'County Durham', 'E12000001', 'North East'),
    ('E06000049', 'Cheshire East', 'E12000002', 'North West'),
    ('E06000050', 'Cheshire West and Chester', 'E12000002', 'North West'),
    ('E06000051', 'Shropshire', 'E12000005', 'West Midlands'),
    ('E06000052', 'Cornwall', 'E12000009', 'South West'),
    ('E06000053', 'Isles of Scilly', 'E12000009', 'South West'),
    ('E06000054', 'Wiltshire', 'E12000009', 'South West'),
    ('E06000055', 'Bedford', 'E12000006', 'East of England'),
    ('E06000056', 'Central Bedfordshire', 'E12000006', 'East of England'),
    ('E06000057', 'Northumberland', 'E12000001', 'North East'),
    ('E06000058', 'Bournemouth, Christchurch and Poole', 'E12000009', 'South West'),
    ('E06000059', 'Dorset', 'E12000009', 'South West'),
    ('E06000060', 'Buckinghamshire', 'E12000008', 'South East'),
    ('E06000061', 'North Northamptonshire', 'E12000004', 'East Midlands'),
    ('E06000062', 'West Northamptonshire', 'E12000004', 'East Midlands'),
    ('E06000063', 'Cumberland', 'E12000002', 'North West'),
    ('E06000064', 'Westmorland and Furness', 'E12000002', 'North West'),
    ('E06000065', 'North Yorkshire', 'E12000003', 'Yorkshire and The Humber'),
    ('E06000066', 'Somerset', 'E12000009', 'South West'),
    ('E07000008', 'Cambridge', 'E12000006', 'East of England'),
    ('E07000009', 'East Cambridgeshire', 'E12000006', 'East of England'),
    ('E07000010', 'Fenland', 'E12000006', 'East of England'),
    ('E07000011', 'Huntingdonshire', 'E12000006', 'East of England'),
    ('E07000012', 'South Cambridgeshire', 'E12000006', 'East of England'),
    ('E07000032', 'Amber Valley', 'E12000004', 'East Midlands'),
    ('E07000033', 'Bolsover', 'E12000004', 'East Midlands'),
    ('E07000034', 'Chesterfield', 'E12000004', 'East Midlands'),
    ('E07000035', 'Derbyshire Dales', 'E12000004', 'East Midlands'),
    ('E07000036', 'Erewash', 'E12000004', 'East Midlands'),
    ('E07000037', 'High Peak', 'E12000004', 'East Midlands'),
    ('E07000038', 'North East Derbyshire', 'E12000004', 'East Midlands'),
    ('E07000039', 'South Derbyshire', 'E12000004', 'East Midlands'),
    ('E07000040', 'East Devon', 'E12000009', 'South West'),
    ('E07000041', 'Exeter', 'E12000009', 'South West'),
    ('E07000042', 'Mid Devon', 'E12000009', 'South West'),
    ('E07000043', 'North Devon', 'E12000009', 'South West'),
    ('E07000044', 'South Hams', 'E12000009', 'South West'),
    ('E07000045', 'Teignbridge', 'E12000009', 'South West'),
    ('E07000046', 'Torridge', 'E12000009', 'South West'),
    ('E07000047', 'West Devon', 'E12000009', 'South West'),
    ('E07000061', 'Eastbourne', 'E12000008', 'South East'),
    ('E07000062', 'Hastings', 'E12000008', 'South East'),
    ('E07000063', 'Lewes', 'E12000008', 'South East'),
    ('E07000064', 'Rother', 'E12000008', 'South East'),
    ('E07000065', 'Wealden', 'E12000008', 'South East'),
    ('E07000066', 'Basildon', 'E12000006', 'East of England'),
    ('E07000067', 'Braintree', 'E12000006', 'East of England'),
    ('E07000068', 'Brentwood', 'E12000006', 'East of England'),
    ('E07000069', 'Castle Point', 'E12000006', 'East of England'),
    ('E07000070', 'Chelmsford', 'E12000006', 'East of England'),
    ('E07000071', 'Colchester', 'E12000006', 'East of England'),
    ('E07000072', 'Epping Forest', 'E12000006', 'East of England'),
    ('E07000073', 'Harlow', 'E12000006', 'East of England'),
    ('E07000074', 'Maldon', 'E12000006', 'East of England'),
    ('E07000075', 'Rochford', 'E12000006', 'East of England'),
    ('E07000076', 'Tendring', 'E12000006', 'East of England'),
    ('E07000077', 'Uttlesford', 'E12000006', 'East of England'),
    ('E07000078', 'Cheltenham', 'E12000009', 'South West'),
    ('E07000079', 'Cotswold', 'E12000009', 'South West'),
    ('E07000080', 'Forest of Dean', 'E12000009', 'South West'),
    ('E07000081', 'Gloucester', 'E12000009', 'South West'),
    ('E07000082', 'Stroud', 'E12000009', 'South West'),
    ('E07000083', 'Tewkesbury', 'E12000009', 'South West'),
    ('E07000084', 'Basingstoke and Deane', 'E12000008', 'South East'),
    ('E07000085', 'East Hampshire', 'E12000008', 'South East'),
    ('E07000086', 'Eastleigh', 'E12000008', 'South East'),
    ('E07000087', 'Fareham', 'E12000008', 'South East'),
    ('E07000088', 'Gosport', 'E12000008', 'South East'),
    ('E07000089', 'Hart', 'E12000008', 'South East'),
    ('E07000090', 'Havant', 'E12000008', 'South East'),
    ('E07000091', 'New Forest', 'E12000008', 'South East'),
    ('E07000092', 'Rushmoor', 'E12000008', 'South East'),
    ('E07000093', 'Test Valley', 'E12000008', 'South East'),
    ('E07000094', 'Winchester', 'E12000008', 'South East'),
    ('E07000095', 'Broxbourne', 'E12000006', 'East of England'),
    ('E07000096', 'Dacorum', 'E12000006', 'East of England'),
    ('E07000098', 'Hertsmere', 'E12000006', 'East of England'),
    ('E07000099', 'North Hertfordshire', 'E12000006', 'East of England'),
    ('E07000102', 'Three Rivers', 'E12000006', 'East of England'),
    ('E07000103', 'Watford', 'E12000006', 'East of England'),
    ('E07000105', 'Ashford', 'E12000008', 'South East'),
    ('E07000106', 'Canterbury', 'E12000008', 'South East'),
    ('E07000107', 'Dartford', 'E12000008', 'South East'),
    ('E07000108', 'Dover', 'E12000008', 'South East'),
    ('E07000109', 'Gravesham', 'E12000008', 'South East'),
    ('E07000110', 'Maidstone', 'E12000008', 'South East'),
    ('E07000111', 'Sevenoaks', 'E12000008', 'South East'),
    ('E07000112', 'Folkestone and Hythe', 'E12000008', 'South East'),
    ('E07000113', 'Swale', 'E12000008', 'South East'),
    ('E07000114', 'Thanet', 'E12000008', 'South East'),
    ('E07000115', 'Tonbridge and Malling', 'E12000008', 'South East'),
    ('E07000116', 'Tunbridge Wells', 'E12000008', 'South East'),
    ('E07000117', 'Burnley', 'E12000002', 'North West'),
    ('E07000118', 'Chorley', 'E12000002', 'North West'),
    ('E07000119', 'Fylde', 'E12000002', 'North West'),
    ('E07000120', 'Hyndburn', 'E12000002', 'North West'),
    ('E07000121', 'Lancaster', 'E12000002', 'North West'),
    ('E07000122', 'Pendle', 'E12000002', 'North West'),
    ('E07000123', 'Preston', 'E12000002', 'North West'),
    ('E07000124', 'Ribble Valley', 'E12000002', 'North West'),
    ('E07000125', 'Rossendale', 'E12000002', 'North West'),
    ('E07000126', 'South Ribble', 'E12000002', 'North West'),
    ('E07000127', 'West Lancashire', 'E12000002', 'North West'),
    ('E07000128', 'Wyre', 'E12000002', 'North West'),
    ('E07000129', 'Blaby', 'E12000004', 'East Midlands'),
    ('E07000130', 'Charnwood', 'E12000004', 'East Midlands'),
    ('E07000131', 'Harborough', 'E12000004', 'East Midlands'),
    ('E07000132', 'Hinckley and Bosworth', 'E12000004', 'East Midlands'),
    ('E07000133', 'Melton', 'E12000004', 'East Midlands'),
    ('E07000134', 'North West Leicestershire', 'E12000004', 'East Midlands'),
    ('E07000135', 'Oadby and Wigston', 'E12000004', 'East Midlands'),
    ('E07000136', 'Boston', 'E12000004', 'East Midlands'),
    ('E07000137', 'East Lindsey', 'E12000004', 'East Midlands'),
    ('E07000138', 'Lincoln', 'E12000004', 'East Midlands'),
    ('E07000139', 'North Kesteven', 'E12000004', 'East Midlands'),
    ('E07000140', 'South Holland', 'E12000004', 'East Midlands'),
    ('E07000141', 'South Kesteven', 'E12000004', 'East Midlands'),
    ('E07000142', 'West Lindsey', 'E12000004', 'East Midlands'),
    ('E07000143', 'Breckland', 'E12000006', 'East of England'),
    ('E07000144', 'Broadland', 'E12000006', 'East of England'),
    ('E07000145', 'Great Yarmouth', 'E12000006', 'East of England'),
    ('E07000146', 'King''s Lynn and West Norfolk', 'E12000006', 'East of England'),
    ('E07000147', 'North Norfolk', 'E12000006', 'East of England'),
    ('E07000148', 'Norwich', 'E12000006', 'East of England'),
    ('E07000149', 'South Norfolk', 'E12000006', 'East of England'),
    ('E07000170', 'Ashfield', 'E12000004', 'East Midlands'),
    ('E07000171', 'Bassetlaw', 'E12000004', 'East Midlands'),
    ('E07000172', 'Broxtowe', 'E12000004', 'East Midlands'),
    ('E07000173', 'Gedling', 'E12000004', 'East Midlands'),
    ('E07000174', 'Mansfield', 'E12000004', 'East Midlands'),
    ('E07000175', 'Newark and Sherwood', 'E12000004', 'East Midlands'),
    ('E07000176', 'Rushcliffe', 'E12000004', 'East Midlands'),
    ('E07000177', 'Cherwell', 'E12000008', 'South East'),
    ('E07000178', 'Oxford', 'E12000008', 'South East'),
    ('E07000179', 'South Oxfordshire', 'E12000008', 'South East'),
    ('E07000180', 'Vale of White Horse', 'E12000008', 'South East'),
    ('E07000181', 'West Oxfordshire', 'E12000008', 'South East'),
    ('E07000192', 'Cannock Chase', 'E12000005', 'West Midlands'),
    ('E07000193', 'East Staffordshire', 'E12000005', 'West Midlands'),
    ('E07000194', 'Lichfield', 'E12000005', 'West Midlands'),
    ('E07000195', 'Newcastle-under-Lyme', 'E12000005', 'West Midlands'),
    ('E07000196', 'South Staffordshire', 'E12000005', 'West Midlands'),
    ('E07000197', 'Stafford', 'E12000005', 'West Midlands'),
    ('E07000198', 'Staffordshire Moorlands', 'E12000005', 'West Midlands'),
    ('E07000199', 'Tamworth', 'E12000005', 'West Midlands'),
    ('E07000200', 'Babergh', 'E12000006', 'East of England'),
    ('E07000202', 'Ipswich', 'E12000006', 'East of England'),
    ('E07000203', 'Mid Suffolk', 'E12000006', 'East of England'),
    ('E07000207', 'Elmbridge', 'E12000008', 'South East'),
    ('E07000208', 'Epsom and Ewell', 'E12000008', 'South East'),
    ('E07000209', 'Guildford', 'E12000008', 'South East'),
    ('E07000210', 'Mole Valley', 'E12000008', 'South East'),
    ('E07000211', 'Reigate and Banstead', 'E12000008', 'South East'),
    ('E07000212', 'Runnymede', 'E12000008', 'South East'),
    ('E07000213', 'Spelthorne', 'E12000008', 'South East'),
    ('E07000214', 'Surrey Heath', 'E12000008', 'South East'),
    ('E07000215', 'Tandridge', 'E12000008', 'South East'),
    ('E07000216', 'Waverley', 'E12000008', 'South East'),
    ('E07000217', 'Woking', 'E12000008', 'South East'),
    ('E07000218', 'North Warwickshire', 'E12000005', 'West Midlands'),
    ('E07000219', 'Nuneaton and Bedworth', 'E12000005', 'West Midlands'),
    ('E07000220', 'Rugby', 'E12000005', 'West Midlands'),
    ('E07000221', 'Stratford-on-Avon', 'E12000005', 'West Midlands'),
    ('E07000222', 'Warwick', 'E12000005', 'West Midlands'),
    ('E07000223', 'Adur', 'E12000008', 'South East'),
    ('E07000224', 'Arun', 'E12000008', 'South East'),
    ('E07000225', 'Chichester', 'E12000008', 'South East'),
    ('E07000226', 'Crawley', 'E12000008', 'South East'),
    ('E07000227', 'Horsham', 'E12000008', 'South East'),
    ('E07000228', 'Mid Sussex', 'E12000008', 'South East'),
    ('E07000229', 'Worthing', 'E12000008', 'South East'),
    ('E07000234', 'Bromsgrove', 'E12000005', 'West Midlands'),
    ('E07000235', 'Malvern Hills', 'E12000005', 'West Midlands'),
    ('E07000236', 'Redditch', 'E12000005', 'West Midlands'),
    ('E07000237', 'Worcester', 'E12000005', 'West Midlands'),
    ('E07000238', 'Wychavon', 'E12000005', 'West Midlands'),
    ('E07000239', 'Wyre Forest', 'E12000005', 'West Midlands'),
    ('E07000240', 'St Albans', 'E12000006', 'East of England'),
    ('E07000241', 'Welwyn Hatfield', 'E12000006', 'East of England'),
    ('E07000242', 'East Hertfordshire', 'E12000006', 'East of England'),
    ('E07000243', 'Stevenage', 'E12000006', 'East of England'),
    ('E07000244', 'East Suffolk', 'E12000006', 'East of England'),
    ('E07000245', 'West Suffolk', 'E12000006', 'East of England'),
    ('E08000001', 'Bolton', 'E12000002', 'North West'),
    ('E08000002', 'Bury', 'E12000002', 'North West'),
    ('E08000003', 'Manchester', 'E12000002', 'North West'),
    ('E08000004', 'Oldham', 'E12000002', 'North West'),
    ('E08000005', 'Rochdale', 'E12000002', 'North West'),
    ('E08000006', 'Salford', 'E12000002', 'North West'),
    ('E08000007', 'Stockport', 'E12000002', 'North West'),
    ('E08000008', 'Tameside', 'E12000002', 'North West'),
    ('E08000009', 'Trafford', 'E12000002', 'North West'),
    ('E08000010', 'Wigan', 'E12000002', 'North West'),
    ('E08000011', 'Knowsley', 'E12000002', 'North West'),
    ('E08000012', 'Liverpool', 'E12000002', 'North West'),
    ('E08000013', 'St. Helens', 'E12000002', 'North West'),
    ('E08000014', 'Sefton', 'E12000002', 'North West'),
    ('E08000015', 'Wirral', 'E12000002', 'North West'),
    ('E08000017', 'Doncaster', 'E12000003', 'Yorkshire and The Humber'),
    ('E08000018', 'Rotherham', 'E12000003', 'Yorkshire and The Humber'),
    ('E08000021', 'Newcastle upon Tyne', 'E12000001', 'North East'),
    ('E08000022', 'North Tyneside', 'E12000001', 'North East'),
    ('E08000023', 'South Tyneside', 'E12000001', 'North East'),
    ('E08000024', 'Sunderland', 'E12000001', 'North East'),
    ('E08000025', 'Birmingham', 'E12000005', 'West Midlands'),
    ('E08000026', 'Coventry', 'E12000005', 'West Midlands'),
    ('E08000027', 'Dudley', 'E12000005', 'West Midlands'),
    ('E08000028', 'Sandwell', 'E12000005', 'West Midlands'),
    ('E08000029', 'Solihull', 'E12000005', 'West Midlands'),
    ('E08000030', 'Walsall', 'E12000005', 'West Midlands'),
    ('E08000031', 'Wolverhampton', 'E12000005', 'West Midlands'),
    ('E08000032', 'Bradford', 'E12000003', 'Yorkshire and The Humber'),
    ('E08000033', 'Calderdale', 'E12000003', 'Yorkshire and The Humber'),
    ('E08000034', 'Kirklees', 'E12000003', 'Yorkshire and The Humber'),
    ('E08000035', 'Leeds', 'E12000003', 'Yorkshire and The Humber'),
    ('E08000036', 'Wakefield', 'E12000003', 'Yorkshire and The Humber'),
    ('E08000037', 'Gateshead', 'E12000001', 'North East'),
    ('E08000038', 'Barnsley', 'E12000003', 'Yorkshire and The Humber'),
    ('E08000039', 'Sheffield', 'E12000003', 'Yorkshire and The Humber'),
    ('E09000001', 'City of London', 'E12000007', 'London'),
    ('E09000002', 'Barking and Dagenham', 'E12000007', 'London'),
    ('E09000003', 'Barnet', 'E12000007', 'London'),
    ('E09000004', 'Bexley', 'E12000007', 'London'),
    ('E09000005', 'Brent', 'E12000007', 'London'),
    ('E09000006', 'Bromley', 'E12000007', 'London'),
    ('E09000007', 'Camden', 'E12000007', 'London'),
    ('E09000008', 'Croydon', 'E12000007', 'London'),
    ('E09000009', 'Ealing', 'E12000007', 'London'),
    ('E09000010', 'Enfield', 'E12000007', 'London'),
    ('E09000011', 'Greenwich', 'E12000007', 'London'),
    ('E09000012', 'Hackney', 'E12000007', 'London'),
    ('E09000013', 'Hammersmith and Fulham', 'E12000007', 'London'),
    ('E09000014', 'Haringey', 'E12000007', 'London'),
    ('E09000015', 'Harrow', 'E12000007', 'London'),
    ('E09000016', 'Havering', 'E12000007', 'London'),
    ('E09000017', 'Hillingdon', 'E12000007', 'London'),
    ('E09000018', 'Hounslow', 'E12000007', 'London'),
    ('E09000019', 'Islington', 'E12000007', 'London'),
    ('E09000020', 'Kensington and Chelsea', 'E12000007', 'London'),
    ('E09000021', 'Kingston upon Thames', 'E12000007', 'London'),
    ('E09000022', 'Lambeth', 'E12000007', 'London'),
    ('E09000023', 'Lewisham', 'E12000007', 'London'),
    ('E09000024', 'Merton', 'E12000007', 'London'),
    ('E09000025', 'Newham', 'E12000007', 'London'),
    ('E09000026', 'Redbridge', 'E12000007', 'London'),
    ('E09000027', 'Richmond upon Thames', 'E12000007', 'London'),
    ('E09000028', 'Southwark', 'E12000007', 'London'),
    ('E09000029', 'Sutton', 'E12000007', 'London'),
    ('E09000030', 'Tower Hamlets', 'E12000007', 'London'),
    ('E09000031', 'Waltham Forest', 'E12000007', 'London'),
    ('E09000032', 'Wandsworth', 'E12000007', 'London'),
    ('E09000033', 'Westminster', 'E12000007', 'London')
ON CONFLICT (lad_code) DO UPDATE SET lad_name = EXCLUDED.lad_name, region_code = EXCLUDED.region_code,
    region_name = EXCLUDED.region_name;

CREATE TABLE IF NOT EXISTS area_region (
    area_id text PRIMARY KEY REFERENCES area_geography(id),
    region_code text NOT NULL CHECK (region_code ~ '^E1200000[1-9]$'),
    region_name text NOT NULL
);

CREATE INDEX IF NOT EXISTS area_region_region_idx ON area_region (region_code);

-- The region of one new area_geography row: a borough from lad_region, an msoa or lsoa from its parent.
CREATE OR REPLACE FUNCTION public.fill_area_region()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.kind = 'borough' THEN
        INSERT INTO area_region (area_id, region_code, region_name)
        SELECT NEW.id, l.region_code, l.region_name FROM lad_region l WHERE l.lad_code = NEW.official_code
        ON CONFLICT (area_id) DO UPDATE SET region_code = EXCLUDED.region_code, region_name = EXCLUDED.region_name;
    ELSE
        INSERT INTO area_region (area_id, region_code, region_name)
        SELECT NEW.id, r.region_code, r.region_name FROM area_region r WHERE r.area_id = NEW.parent_id
        ON CONFLICT (area_id) DO UPDATE SET region_code = EXCLUDED.region_code, region_name = EXCLUDED.region_name;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS area_region_fill ON area_geography;

CREATE TRIGGER area_region_fill
AFTER INSERT ON area_geography
FOR EACH ROW EXECUTE FUNCTION fill_area_region();

-- Every existing area's region, from the hierarchy (boroughs, then msoas, then lsoas).
CREATE OR REPLACE FUNCTION public.refresh_area_region()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    WITH borough AS (
        SELECT g.id, l.region_code, l.region_name
        FROM area_geography g JOIN lad_region l ON l.lad_code = g.official_code
        WHERE g.kind = 'borough'
    ), msoa AS (
        SELECT g.id, b.region_code, b.region_name
        FROM area_geography g JOIN borough b ON b.id = g.parent_id WHERE g.kind = 'msoa'
    ), lsoa AS (
        SELECT g.id, m.region_code, m.region_name
        FROM area_geography g JOIN msoa m ON m.id = g.parent_id WHERE g.kind = 'lsoa'
    )
    INSERT INTO area_region (area_id, region_code, region_name)
    SELECT * FROM borough UNION ALL SELECT * FROM msoa UNION ALL SELECT * FROM lsoa
    ON CONFLICT (area_id) DO UPDATE SET region_code = EXCLUDED.region_code, region_name = EXCLUDED.region_name
    WHERE (area_region.region_code, area_region.region_name)
          IS DISTINCT FROM (EXCLUDED.region_code, EXCLUDED.region_name);
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.area_rank_region(p_area_id text)
RETURNS text
LANGUAGE sql
STABLE PARALLEL SAFE
AS $$
    SELECT region_code FROM area_region WHERE area_id = p_area_id
$$;

-- The region of the LAD nearest to a point (0 m inside it), e.g. for a school's own region.
CREATE OR REPLACE FUNCTION public.point_rank_region(p_point geometry)
RETURNS text
LANGUAGE sql
STABLE PARALLEL SAFE
AS $$
    SELECT r.region_code
    FROM area_geography g JOIN area_region r ON r.area_id = g.id
    WHERE g.kind = 'borough'
    ORDER BY g.geometry <-> p_point, g.id
    LIMIT 1
$$;

-- from 001-ons-statistical-boundaries.sql
CREATE OR REPLACE FUNCTION enforce_geography_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_kind geography_kind;
BEGIN
    IF GeometryType(NEW.geometry) != 'MULTIPOLYGON' THEN
        RAISE EXCEPTION 'Area geography geometry must be a MultiPolygon';
    END IF;
    IF ST_SRID(NEW.geometry) != 4326 THEN
        RAISE EXCEPTION 'Area geography geometry must use SRID 4326';
    END IF;
    IF NOT ST_IsValid(NEW.geometry) THEN
        RAISE EXCEPTION 'Area geography geometry is not valid';
    END IF;
    IF NEW.kind = 'borough' THEN
        IF NEW.parent_id IS NOT NULL THEN
            RAISE EXCEPTION 'Borough rows must not have a parent';
        END IF;
        IF NEW.official_code !~ '^E0[6-9][0-9]{6}$' THEN
            RAISE EXCEPTION 'Borough is not an English local authority district: %', NEW.official_code;
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.parent_id IS NULL THEN
        RAISE EXCEPTION 'Non-borough rows must reference a parent';
    END IF;
    SELECT kind INTO parent_kind FROM area_geography WHERE id = NEW.parent_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent geography does not exist: %', NEW.parent_id;
    END IF;
    IF NEW.kind = 'lsoa' AND parent_kind != 'msoa' THEN
        RAISE EXCEPTION 'LSOA rows must reference an MSOA parent';
    END IF;
    IF NEW.kind = 'msoa' AND parent_kind != 'borough' THEN
        RAISE EXCEPTION 'MSOA rows must reference a borough parent';
    END IF;
    RETURN NEW;
END;
$$;

-- from 054-area-london-rank.sql
CREATE OR REPLACE FUNCTION public.rebuild_area_london_rank()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE total integer := 0; affected integer;
BEGIN
    DELETE FROM area_london_rank;

    INSERT INTO area_london_rank (geography_id, rank_id, value, london_percentile, ranked, source_release_id)
    SELECT n.geography_id, 'quiet', n.any_55_share,
           round(100 * percent_rank() OVER (PARTITION BY area_rank_region(n.geography_id) ORDER BY n.any_55_share))::smallint,
           count(*) OVER (PARTITION BY area_rank_region(n.geography_id)),
           n.source_release_id
    FROM area_noise n JOIN area_geography g ON g.id = n.geography_id AND g.kind = 'lsoa'
    WHERE n.any_55_share IS NOT NULL;
    GET DIAGNOSTICS affected = ROW_COUNT; total := total + affected;

    INSERT INTO area_london_rank (geography_id, rank_id, value, london_percentile, ranked, source_release_id)
    -- The station-access ETL already stores an ascending LSOA percentile within the region: reuse it.
    SELECT walk.geography_id, 'station-walk', walk.value, walk.london_percentile,
           count(*) OVER (PARTITION BY area_rank_region(walk.geography_id)),
           walk.source_release_id
    FROM (
        SELECT DISTINCT ON (mv.geography_id) mv.geography_id, mv.value, mv.london_percentile, mv.source_release_id
        FROM metric_value mv JOIN area_geography g ON g.id = mv.geography_id AND g.kind = 'lsoa'
        WHERE mv.metric_id = 'station-access' AND mv.value IS NOT NULL AND mv.london_percentile IS NOT NULL
        ORDER BY mv.geography_id, mv.period DESC
    ) walk;
    GET DIAGNOSTICS affected = ROW_COUNT; total := total + affected;

    -- Nearest park as personal_places.NEAREST_PARK_SQL finds it (geography KNN, exact metres).
    INSERT INTO area_london_rank (geography_id, rank_id, value, london_percentile, ranked, source_release_id)
    SELECT park.geography_id, 'park-distance', park.metres,
           round(100 * percent_rank() OVER (PARTITION BY area_rank_region(park.geography_id) ORDER BY park.metres))::smallint,
           count(*) OVER (PARTITION BY area_rank_region(park.geography_id)),
           park.source_release_id
    FROM (
        SELECT area.id AS geography_id, nearest.metres, nearest.source_release_id
        FROM (SELECT g.id, ST_PointOnSurface(g.geometry)::geography AS point
              FROM area_geography g WHERE g.kind = 'lsoa') area
        CROSS JOIN LATERAL (
            SELECT round(ST_Distance(p.geometry::geography, area.point)) AS metres, p.source_release_id
            FROM place_park p ORDER BY p.geometry::geography <-> area.point LIMIT 1
        ) nearest
    ) park;
    GET DIAGNOSTICS affected = ROW_COUNT; total := total + affected;

    -- Primaries ranked as personal_places.top_schools does: latest year, cohort 30+, not suppressed.
    INSERT INTO area_london_rank (geography_id, rank_id, value, london_percentile, ranked, detail,
                                  source_release_id)
    WITH latest AS (
        SELECT DISTINCT ON (s.urn) s.urn, s.name, s.location, (o->>'value')::real AS value,
               o->>'academicYear' AS academic_year, o->>'sourceRelease' AS source_release_id
        FROM school s
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.attributes->'observations', '[]'::jsonb)) o
        WHERE s.phase = 'primary'
          AND o->>'measure' = 'Expected standard in reading, writing and maths (%)'
          AND jsonb_typeof(o->'value') = 'number'
          AND coalesce((o->>'cohortSize')::numeric, 0) >= 30
          AND NOT coalesce((o->>'suppressed')::boolean, false)
        ORDER BY s.urn, o->>'academicYear' DESC, (o->>'value')::real DESC
    ), located AS (
        SELECT latest.*, point_rank_region(latest.location) AS region FROM latest
    ), ranked AS (
        SELECT located.*, round(100 * percent_rank() OVER (PARTITION BY region ORDER BY value))::smallint AS pct,
               count(*) OVER (PARTITION BY region) AS schools
        FROM located
    )
    SELECT DISTINCT ON (area.id) area.id, 'best-primary', r.value, r.pct, r.schools,
           jsonb_build_object('urn', r.urn, 'name', r.name, 'academicYear', r.academic_year,
                              'distanceMetres', round(ST_Distance(r.location::geography, area.point))::integer),
           r.source_release_id
    FROM (SELECT g.id, ST_PointOnSurface(g.geometry) AS geom, ST_PointOnSurface(g.geometry)::geography AS point
          FROM area_geography g WHERE g.kind = 'lsoa') area
    JOIN ranked r ON r.location && ST_Expand(area.geom, 0.02)  -- ~1.4-2.2 km box, then exact metres
                 AND ST_DWithin(r.location::geography, area.point, 1000)
    ORDER BY area.id, r.value DESC, ST_Distance(r.location::geography, area.point), r.urn;
    GET DIAGNOSTICS affected = ROW_COUNT; total := total + affected;

    RETURN total;
END;
$$;

-- from 069-area-good-value.sql
CREATE OR REPLACE FUNCTION public.rebuild_area_good_value()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_score_vector;
    INSERT INTO area_score_vector (geography_id, safety, schools, station, quiet, parks, air)
    WITH crime AS (
        SELECT DISTINCT ON (mv.geography_id) mv.geography_id, mv.london_percentile AS pct
        FROM metric_value mv
        WHERE mv.metric_id = 'crime' AND mv.geography_id LIKE 'uk:lsoa:%' AND mv.london_percentile IS NOT NULL
        ORDER BY mv.geography_id, mv.period DESC
    ), air AS (
        SELECT DISTINCT ON (mv.geography_id) mv.geography_id, mv.london_percentile AS pct
        FROM metric_value mv
        WHERE mv.metric_id = 'air-no2' AND mv.geography_id LIKE 'uk:lsoa:%' AND mv.london_percentile IS NOT NULL
        ORDER BY mv.geography_id, mv.period DESC
    ), ranks AS (
        SELECT geography_id,
               max(london_percentile) FILTER (WHERE rank_id = 'best-primary') AS schools,
               max(london_percentile) FILTER (WHERE rank_id = 'station-walk') AS walk,
               max(london_percentile) FILTER (WHERE rank_id = 'quiet') AS noisy,
               max(london_percentile) FILTER (WHERE rank_id = 'park-distance') AS park
        FROM area_london_rank GROUP BY geography_id
    )
    SELECT g.id, 100 - crime.pct, ranks.schools, 100 - ranks.walk, 100 - ranks.noisy, 100 - ranks.park, 100 - air.pct
    FROM area_geography g
    LEFT JOIN crime ON crime.geography_id = g.id
    LEFT JOIN air ON air.geography_id = g.id
    LEFT JOIN ranks ON ranks.geography_id = g.id
    WHERE g.kind = 'lsoa'
      AND num_nonnulls(crime.pct, ranks.schools, ranks.walk, ranks.noisy, ranks.park, air.pct) > 0;

    DROP TABLE IF EXISTS pg_temp.good_value_candidate;
    CREATE TEMP TABLE good_value_candidate ON COMMIT DROP AS
    SELECT b.geography_id, b.property_type, b.p50 AS price, b.sales, b.source_release_id,
           v.safety, v.schools, v.station, v.quiet, v.parks, v.air, area_rank_region(b.geography_id) AS region
    FROM area_price_band b
    JOIN area_geography g ON g.id = b.geography_id AND g.kind = 'lsoa'
    JOIN area_score_vector v ON v.geography_id = b.geography_id
    WHERE b.sales >= 20 AND b.p50 > 0
      AND num_nonnulls(v.safety, v.schools, v.station, v.quiet, v.parks, v.air) >= 4;
    CREATE INDEX ON good_value_candidate (property_type);
    ANALYZE good_value_candidate;

    DELETE FROM area_good_value;
    INSERT INTO area_good_value (geography_id, property_type, typical_price, sales, peers, peer_price, value_ratio,
                                 source_release_id)
    SELECT a.geography_id, a.property_type, a.price, a.sales, peer.n, peer.price,
           round((a.price::numeric / peer.price), 3)::real, a.source_release_id
    FROM good_value_candidate a
    CROSS JOIN LATERAL (
        SELECT count(*)::smallint AS n, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY near.price))::integer AS price
        FROM (
            SELECT b.price
            FROM good_value_candidate b
            CROSS JOIN LATERAL (SELECT
                (a.safety IS NOT NULL AND b.safety IS NOT NULL)::int + (a.schools IS NOT NULL AND b.schools IS NOT NULL)::int
              + (a.station IS NOT NULL AND b.station IS NOT NULL)::int + (a.quiet IS NOT NULL AND b.quiet IS NOT NULL)::int
              + (a.parks IS NOT NULL AND b.parks IS NOT NULL)::int + (a.air IS NOT NULL AND b.air IS NOT NULL)::int AS shared,
                coalesce((a.safety - b.safety) ^ 2, 0) + coalesce((a.schools - b.schools) ^ 2, 0)
              + coalesce((a.station - b.station) ^ 2, 0) + coalesce((a.quiet - b.quiet) ^ 2, 0)
              + coalesce((a.parks - b.parks) ^ 2, 0) + coalesce((a.air - b.air) ^ 2, 0) AS gap) d
            WHERE b.property_type = a.property_type AND b.region IS NOT DISTINCT FROM a.region
              AND b.geography_id <> a.geography_id AND d.shared >= 4
            ORDER BY d.gap / d.shared, b.geography_id
            LIMIT 50
        ) near
    ) peer
    WHERE peer.n > 0;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

-- from 096-same-carrier-restatement.sql
CREATE OR REPLACE FUNCTION public.rebuild_area_price_bands(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    first_period date;
    window_start date;
    affected integer;
    n_window integer;
    n_adjusted integer;
    c_lsoa integer;
    c_msoa integer;
    c_borough integer;
BEGIN
    SELECT max(period), min(period) INTO latest, first_period
    FROM metric_value WHERE metric_id = 'price-per-square-metre';
    IF latest IS NULL THEN
        RETURN 0;
    END IF;
    window_start := make_date(EXTRACT(YEAR FROM latest)::integer - 3, 1, 1);
    DELETE FROM area_price_band;
    DELETE FROM area_price_year;

    DROP TABLE IF EXISTS located_sale;
    -- Standard market sales of the four Price Paid types, with their LSOA, MSOA and borough.
    CREATE TEMP TABLE located_sale ON COMMIT DROP AS
    SELECT s.price, s.property_type, s.sale_month, EXTRACT(YEAR FROM s.completion_date)::smallint AS year,
           l.id AS lsoa_id, m.id AS msoa_id, m.parent_id AS borough_id
    FROM sale s
    JOIN address a ON a.id = s.address_id
    JOIN area_geography l ON l.id = a.geography_id AND l.kind = 'lsoa'
    JOIN area_geography m ON m.id = l.parent_id AND m.kind = 'msoa'
    WHERE s.source_release_id = p_source_release_id
      AND s.ppd_category = 'A' AND s.property_type IN ('D', 'S', 'T', 'F') AND s.price >= 20000;

    -- Each in-window sale adjusted to the latest month by its carrier's £/m² index, but only when both ends come
    -- from the same carrier (#185): the LSOA's own index when both months are observed, else the
    -- fallback carrier's own index when both months fell back to the same carrier area
    -- (carrier_geography_id, migration 095). A mixed pair — observed at one end and fallback at
    -- the other, or fallbacks from two different carriers — would divide an observed LSOA median
    -- by a borough median or vice versa, so the sale is dropped from the band, not mixed.
    DROP TABLE IF EXISTS adjusted_sale;
    CREATE TEMP TABLE adjusted_sale ON COMMIT DROP AS
    SELECT ls.lsoa_id, ls.msoa_id, ls.borough_id, ls.property_type,
           ls.price * now_v.value / at_sale.value AS price,
           CASE WHEN at_sale.quality = 'observed' THEN 'lsoa'
                ELSE split_part(at_sale.carrier_geography_id, ':', 2) END AS carrier
    FROM located_sale ls
    JOIN metric_value at_sale ON at_sale.metric_id = 'price-per-square-metre'
         AND at_sale.geography_id = ls.lsoa_id AND at_sale.period = GREATEST(ls.sale_month, first_period)
    JOIN metric_value now_v ON now_v.metric_id = 'price-per-square-metre'
         AND now_v.geography_id = ls.lsoa_id AND now_v.period = latest
    WHERE ls.sale_month >= window_start AND ls.sale_month <= latest
      AND at_sale.value > 0 AND now_v.value > 0
      AND now_v.value / at_sale.value BETWEEN 0.25 AND 6
      AND (at_sale.quality = 'observed' AND now_v.quality = 'observed'
           OR (at_sale.quality = 'fallback' AND now_v.quality = 'fallback'
               AND at_sale.carrier_geography_id IS NOT NULL
               AND at_sale.carrier_geography_id = now_v.carrier_geography_id));

    SELECT count(*) INTO n_window FROM located_sale
     WHERE sale_month >= window_start AND sale_month <= latest;
    SELECT count(*) FILTER (WHERE carrier = 'lsoa'),
           count(*) FILTER (WHERE carrier = 'msoa'),
           count(*) FILTER (WHERE carrier = 'borough')
      INTO c_lsoa, c_msoa, c_borough FROM adjusted_sale;
    n_adjusted := c_lsoa + c_msoa + c_borough;
    RAISE NOTICE 'rebuild_area_price_bands: adjusted % of % in-window sales to % by same-carrier index (lsoa %, msoa %, borough %); % dropped as mixed-carrier',
        n_adjusted, n_window, latest, c_lsoa, c_msoa, c_borough, n_window - n_adjusted;

    INSERT INTO area_price_band (geography_id, property_type, window_start, period, sales,
        p10, p25, p50, p75, p90, source_release_id)
    WITH by_level AS (
        SELECT lsoa_id AS geography_id, property_type, price FROM adjusted_sale
        UNION ALL SELECT msoa_id, property_type, price FROM adjusted_sale
        UNION ALL SELECT borough_id, property_type, price FROM adjusted_sale WHERE borough_id IS NOT NULL
    )
    SELECT geography_id, coalesce(property_type, '*'), window_start, latest, count(*),
           round(percentile_cont(0.10) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.25) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.50) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.90) WITHIN GROUP (ORDER BY price))::integer,
           p_source_release_id
    FROM by_level
    GROUP BY GROUPING SETS ((geography_id, property_type), (geography_id));
    GET DIAGNOSTICS affected = ROW_COUNT;

    INSERT INTO area_price_year (geography_id, property_type, year, sales, p10, p25, p50, p75, p90,
        source_release_id)
    WITH by_level AS (
        SELECT lsoa_id AS geography_id, property_type, year, price FROM located_sale
        UNION ALL SELECT msoa_id, property_type, year, price FROM located_sale
        UNION ALL SELECT borough_id, property_type, year, price FROM located_sale WHERE borough_id IS NOT NULL
    )
    SELECT geography_id, property_type, year, count(*),
           round(percentile_cont(0.10) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.25) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.50) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.90) WITHIN GROUP (ORDER BY price))::integer,
           p_source_release_id
    FROM by_level
    GROUP BY geography_id, property_type, year;

    -- "Typical home price": the median adjusted price of a whole home per LSOA, by type.
    DELETE FROM metric_value WHERE metric_id IN ('typical-price', 'typical-price-flat',
        'typical-price-terraced', 'typical-price-semi', 'typical-price-detached');
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    SELECT k.metric_id, 'lsoa', '£', 'higher-is-more', '{}'::jsonb, p_source_release_id
    FROM (VALUES ('typical-price'), ('typical-price-flat'), ('typical-price-terraced'),
                 ('typical-price-semi'), ('typical-price-detached')) k(metric_id)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile,
        england_percentile, sample_count, quality, source_release_id)
    WITH kinds(code, metric_id) AS (
        VALUES ('*', 'typical-price'), ('F', 'typical-price-flat'), ('T', 'typical-price-terraced'),
               ('S', 'typical-price-semi'), ('D', 'typical-price-detached')
    ), chosen AS (
        SELECT l.id AS geography_id, k.metric_id,
               CASE WHEN bl.sales >= 20 THEN bl.p50 WHEN bm.sales >= 20 THEN bm.p50
                    WHEN bb.sales >= 5 THEN bb.p50 END AS value,
               CASE WHEN bl.sales >= 20 THEN bl.sales WHEN bm.sales >= 20 THEN bm.sales
                    WHEN bb.sales >= 5 THEN bb.sales ELSE coalesce(bl.sales, 0) END AS n,
               CASE WHEN bl.sales >= 20 THEN 'observed' WHEN bm.sales >= 20 OR bb.sales >= 5 THEN 'fallback'
                    ELSE 'suppressed' END::metric_quality AS quality
        FROM area_geography l
        JOIN area_geography m ON m.id = l.parent_id
        CROSS JOIN kinds k
        LEFT JOIN area_price_band bl ON bl.geography_id = l.id AND bl.property_type = k.code
        LEFT JOIN area_price_band bm ON bm.geography_id = m.id AND bm.property_type = k.code
        LEFT JOIN area_price_band bb ON bb.geography_id = m.parent_id AND bb.property_type = k.code
        WHERE l.kind = 'lsoa'
    ), ranked AS (
        SELECT geography_id, metric_id,
               round(100 * percent_rank() OVER (PARTITION BY metric_id, area_rank_region(geography_id) ORDER BY value))::smallint AS pct
        FROM chosen WHERE value IS NOT NULL
    )
    SELECT c.geography_id, c.metric_id, latest, c.value, r.pct, NULL, c.n, c.quality, p_source_release_id
    FROM chosen c
    LEFT JOIN ranked r ON r.geography_id = c.geography_id AND r.metric_id = c.metric_id;

    -- Definitions: a five-step legend at the 10th–90th percentiles of each layer's LSOA values.
    UPDATE metric_definition d
       SET source_release_id = p_source_release_id,
           definition = jsonb_build_object(
               'label', 'Typical home price' || q.suffix,
               'shortLabel', 'Typical home price',
               'description', 'Median price of standard sales' || q.words || ' since ' || EXTRACT(YEAR FROM window_start)
                   || ', each adjusted to ' || to_char(latest, 'Mon YYYY') || ' by the local price index. '
                   || 'Area-level only: not a valuation of any home.',
               'sourceId', 'hmlr-price-paid', 'sourceName', 'HM Land Registry Price Paid',
               'methodologyPath', '/guide/typical-price', 'freshness', to_char(latest, 'YYYY-MM'),
               'legend', CASE WHEN q.c1 IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(
                   jsonb_build_object('value', q.c1, 'colour', '#c7e9b4', 'label', '£' || round(q.c1 / 1000) || 'k'),
                   jsonb_build_object('value', q.c2, 'colour', '#7fcdbb', 'label', '£' || round(q.c2 / 1000) || 'k'),
                   jsonb_build_object('value', q.c3, 'colour', '#1d91c0', 'label', '£' || round(q.c3 / 1000) || 'k'),
                   jsonb_build_object('value', q.c4, 'colour', '#253494', 'label', '£' || round(q.c4 / 1000) || 'k'),
                   jsonb_build_object('value', q.c5, 'colour', '#081d58', 'label', '£' || round(q.c5 / 1000) || 'k+')) END,
               'caveats', jsonb_build_array(
                   'Areas with fewer than 20 sales of the type use their MSOA, then their borough (at least 5 sales); below that no value is shown.',
                   'Standard market sales only (Price Paid category A). The index adjusts for the market, not for condition or improvements.',
                   'Contains HM Land Registry data © Crown copyright and database right. Licensed under the Open Government Licence v3.0.'))
      FROM (
        SELECT k.metric_id,
               CASE k.metric_id WHEN 'typical-price' THEN '' WHEN 'typical-price-flat' THEN ': flats'
                    WHEN 'typical-price-terraced' THEN ': terraced' WHEN 'typical-price-semi' THEN ': semi-detached'
                    ELSE ': detached' END AS suffix,
               CASE k.metric_id WHEN 'typical-price' THEN '' WHEN 'typical-price-flat' THEN ' of flats'
                    WHEN 'typical-price-terraced' THEN ' of terraced houses'
                    WHEN 'typical-price-semi' THEN ' of semi-detached houses' ELSE ' of detached houses' END AS words,
               round(percentile_cont(0.1) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c1,
               round(percentile_cont(0.3) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c2,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c3,
               round(percentile_cont(0.7) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c4,
               round(percentile_cont(0.9) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c5
        FROM (VALUES ('typical-price'), ('typical-price-flat'), ('typical-price-terraced'),
                     ('typical-price-semi'), ('typical-price-detached')) k(metric_id)
        LEFT JOIN metric_value v ON v.metric_id = k.metric_id AND v.value IS NOT NULL
        GROUP BY k.metric_id
      ) q
     WHERE d.id = q.metric_id;
    RETURN affected;
END;
$$;

-- from 098-pre-index-sales-unrestated.sql
CREATE OR REPLACE FUNCTION public.rebuild_stock_values(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    affected integer;
    c_lsoa integer;
    c_msoa integer;
    c_borough integer;
    c_pre_index integer;
BEGIN
    DELETE FROM property_stock_value;
    -- The dwelling's last standard sale restated by its carrier's £/m² index, but only when
    -- both ends come from the same carrier (#185): the LSOA's own index when both months are
    -- observed, else the fallback carrier's own index when both months fell back to the same
    -- carrier area (carrier_geography_id, migration 095). A mixed pair is dropped, not mixed:
    -- index_carrier/index_geography_id always name the carrier actually used.
    -- A sale before the index's first month (June 2006) is kept with its recorded facts but
    -- never restated (#249): its restated_* and index_* columns stay null and
    -- unrestated_reason = 'pre-index-sale', so it is left out of every median and count
    -- instead of being moved forward as if it had sold in the index's first month.
    DROP TABLE IF EXISTS restated_stock;
    CREATE TEMP TABLE restated_stock ON COMMIT DROP AS
    WITH bounds AS (
        SELECT max(period) AS latest, min(period) AS first
        FROM metric_value WHERE metric_id = 'price-per-square-metre'
    ), last_sale AS (
        SELECT DISTINCT ON (p.uprn) p.uprn, p.geography_id, s.sale_month, s.completion_date, s.price,
               s.floor_area_square_metres, s.price_per_square_metre
        FROM property p
        JOIN sale s ON s.address_id = p.address_id
        WHERE s.ppd_category = 'A' AND s.property_type <> 'O' AND s.price >= 20000
          AND s.price_per_square_metre IS NOT NULL
        ORDER BY p.uprn, s.completion_date DESC, s.price DESC
    ), indexed AS (
        SELECT l.*, b.latest, b.first FROM last_sale l, bounds b
    )
    SELECT i.uprn, i.latest AS period, i.sale_month AS sale_period, i.completion_date,
           i.price AS nominal_price, i.floor_area_square_metres,
           i.price_per_square_metre AS sale_price_per_square_metre,
           CASE WHEN at_sale.quality = 'observed' THEN 'lsoa'
                ELSE split_part(at_sale.carrier_geography_id, ':', 2) END AS index_carrier,
           COALESCE(at_sale.carrier_geography_id, i.geography_id) AS index_geography_id,
           at_sale.value AS index_at_sale, now_v.value AS index_latest,
           round((i.price * now_v.value / at_sale.value / i.floor_area_square_metres)::numeric, 2)
               AS restated_price_per_square_metre,
           round(i.price * now_v.value / at_sale.value)::integer AS restated_value,
           stock_value_confidence(i.sale_month, i.latest,
               CASE WHEN at_sale.quality = 'observed' THEN 'lsoa'
                    ELSE split_part(at_sale.carrier_geography_id, ':', 2) END) AS confidence,
           NULL::text AS unrestated_reason
    FROM indexed i
    -- The index at the sale's own month: a sale before the first index month has no row here
    -- and takes the unrestated branch below, never the first month's index.
    JOIN metric_value at_sale ON at_sale.metric_id = 'price-per-square-metre'
         AND at_sale.geography_id = i.geography_id AND at_sale.period = i.sale_month
    JOIN metric_value now_v ON now_v.metric_id = 'price-per-square-metre'
         AND now_v.geography_id = i.geography_id AND now_v.period = i.latest
    WHERE i.sale_month >= i.first
      AND at_sale.value > 0 AND now_v.value > 0
      AND now_v.value / at_sale.value BETWEEN 0.25 AND 6
      AND (at_sale.quality = 'observed' AND now_v.quality = 'observed'
           OR (at_sale.quality = 'fallback' AND now_v.quality = 'fallback'
               AND at_sale.carrier_geography_id IS NOT NULL
               AND at_sale.carrier_geography_id = now_v.carrier_geography_id))
    UNION ALL
    SELECT i.uprn, i.latest, i.sale_month, i.completion_date, i.price, i.floor_area_square_metres,
           i.price_per_square_metre, NULL, i.geography_id, NULL, NULL, NULL, NULL, 'low',
           'pre-index-sale'
    FROM indexed i
    WHERE i.sale_month < i.first;

    SELECT count(*) FILTER (WHERE index_carrier = 'lsoa'),
           count(*) FILTER (WHERE index_carrier = 'msoa'),
           count(*) FILTER (WHERE index_carrier = 'borough'),
           count(*) FILTER (WHERE unrestated_reason = 'pre-index-sale')
      INTO c_lsoa, c_msoa, c_borough, c_pre_index FROM restated_stock;
    RAISE NOTICE 'rebuild_stock_values: restated % dwellings by same-carrier index (lsoa %, msoa %, borough %); mixed-carrier sales dropped; % pre-index sales kept unrestated',
        c_lsoa + c_msoa + c_borough, c_lsoa, c_msoa, c_borough, c_pre_index;

    INSERT INTO property_stock_value (uprn, period, sale_period, completion_date, nominal_price,
        floor_area_square_metres, sale_price_per_square_metre, index_carrier, index_geography_id,
        index_at_sale, index_latest, restated_price_per_square_metre, restated_value, confidence,
        unrestated_reason, source_release_id)
    SELECT uprn, period, sale_period, completion_date, nominal_price, floor_area_square_metres,
           sale_price_per_square_metre, index_carrier, index_geography_id, index_at_sale, index_latest,
           restated_price_per_square_metre, restated_value, confidence, unrestated_reason,
           p_source_release_id
    FROM restated_stock;
    GET DIAGNOSTICS affected = ROW_COUNT;

    -- Area stock value: median restated £/m² of the restated dwellings per LSOA. Unrestated
    -- (pre-index) dwellings are in neither the median nor the count.
    DELETE FROM metric_value WHERE metric_id = 'stock-value-per-square-metre';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile,
        england_percentile, sample_count, quality, source_release_id)
    WITH medians AS (
        SELECT p.geography_id, v.period,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY v.restated_price_per_square_metre) AS value,
               count(*) AS n
        FROM property_stock_value v JOIN property p ON p.uprn = v.uprn
        WHERE v.restated_price_per_square_metre IS NOT NULL
        GROUP BY p.geography_id, v.period
    ), ranked AS (
        SELECT *, round(100 * percent_rank() OVER (PARTITION BY area_rank_region(geography_id) ORDER BY value))::smallint AS pct
        FROM medians WHERE n >= 10
    )
    SELECT g.id, 'stock-value-per-square-metre', m.period,
           CASE WHEN m.n >= 10 THEN round(m.value::numeric, 2) END, r.pct, NULL, m.n,
           CASE WHEN m.n >= 10 THEN 'observed'::metric_quality ELSE 'suppressed'::metric_quality END,
           p_source_release_id
    FROM area_geography g
    JOIN medians m ON m.geography_id = g.id
    LEFT JOIN ranked r ON r.geography_id = g.id
    WHERE g.kind = 'lsoa';
    UPDATE metric_definition
       SET definition = jsonb_set(definition, '{freshness}',
               to_jsonb(to_char((SELECT max(period) FROM property_stock_value), 'YYYY-MM'))),
           source_release_id = p_source_release_id
     WHERE id = 'stock-value-per-square-metre';
    RETURN affected;
END;
$$;

-- from 062-area-kids.sql
CREATE OR REPLACE FUNCTION public.rebuild_area_kids()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    first_year smallint := (SELECT min(year) FROM road_casualty);
    years integer := coalesce((SELECT max(year) - min(year) + 1 FROM road_casualty), 0);
    sources text[] := ARRAY(
        SELECT DISTINCT s FROM (
            SELECT source_release_id AS s FROM nursery_setting
            UNION SELECT source_release_id FROM road_casualty
            UNION SELECT source_release_id FROM cycle_lane) u ORDER BY 1);
    written integer;
BEGIN
    DELETE FROM area_kids;
    WITH area AS (
        SELECT g.id, g.kind, ST_Transform(ST_PointOnSurface(g.geometry), 27700) AS point
        FROM area_geography g WHERE g.kind IN ('lsoa', 'msoa')
    ), nursery AS (
        SELECT a.id, count(n.urn) FILTER (WHERE n.well_rated IS NOT NULL) AS rated,
               count(n.urn) FILTER (WHERE n.well_rated) AS good
        FROM area a LEFT JOIN nursery_setting n ON ST_DWithin(n.location, a.point, 1000)
        GROUP BY a.id
    ), pair AS (
        SELECT a.id, c.year, c.child, c.severity, c.road_user
        FROM area a JOIN road_casualty c ON ST_DWithin(c.location, a.point, 500)
    ), yearly AS (
        SELECT a.id, array_agg(coalesce(p.n, 0)::integer ORDER BY s.year) AS by_year
        FROM area a
        CROSS JOIN generate_series(first_year, first_year + years - 1) AS s(year)
        LEFT JOIN (SELECT id, year, count(*) AS n FROM pair GROUP BY id, year) p
          ON p.id = a.id AND p.year = s.year
        GROUP BY a.id
    ), casualty AS (
        SELECT a.id, coalesce(y.by_year, '{}') AS by_year,
               count(p.id) AS total,
               count(p.id) FILTER (WHERE p.child) AS child,
               count(p.id) FILTER (WHERE p.severity < 3) AS serious,
               count(p.id) FILTER (WHERE p.road_user = 'cyclist') AS cyclist
        FROM area a LEFT JOIN pair p USING (id) LEFT JOIN yearly y USING (id)
        GROUP BY a.id, y.by_year
    ), lane AS (
        SELECT a.id,
               coalesce(sum(ST_Length(ST_Intersection(l.geometry, ST_Buffer(a.point, 1000))))
                        FILTER (WHERE l.kind = 'protected'), 0) / 1000 AS protected_km,
               coalesce(sum(ST_Length(ST_Intersection(l.geometry, ST_Buffer(a.point, 1000))))
                        FILTER (WHERE l.kind = 'cycleway'), 0) / 1000 AS cycleway_km
        FROM area a LEFT JOIN cycle_lane l ON ST_DWithin(l.geometry, a.point, 1000)
        GROUP BY a.id
    ), joined AS (
        SELECT a.id, a.kind, n.rated, n.good,
               CASE WHEN n.rated >= 3 THEN round(100.0 * n.good / n.rated, 1) END AS share,
               c.by_year, c.total, c.child, c.serious, c.cyclist,
               round(lane.protected_km::numeric, 2) AS protected_km,
               round(lane.cycleway_km::numeric, 2) AS cycleway_km
        FROM area a JOIN nursery n USING (id) JOIN casualty c USING (id) JOIN lane USING (id)
    )
    INSERT INTO area_kids
    SELECT j.id, j.rated, j.good, j.share,
           round(100 * percent_rank() OVER (PARTITION BY j.kind, area_rank_region(j.id) ORDER BY j.good)),
           first_year, j.by_year, j.total, j.child, j.serious, j.cyclist,
           CASE WHEN years > 0 THEN round(100 * percent_rank() OVER (PARTITION BY j.kind, area_rank_region(j.id) ORDER BY j.total)) END,
           j.protected_km, j.cycleway_km,
           round(100 * percent_rank() OVER (PARTITION BY j.kind, area_rank_region(j.id) ORDER BY j.protected_km + j.cycleway_km)),
           sources
    FROM joined j;
    GET DIAGNOSTICS written = ROW_COUNT;
    RETURN written;
END;
$$;

-- from 064-nature.sql
CREATE OR REPLACE FUNCTION public.rebuild_area_nature()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_nature;
    INSERT INTO area_nature (geography_id, green_share, street_trees, trees_per_hectare, top_trees,
        site_name, site_kind, site_metres, source_release_ids)
    WITH lsoa AS (
        SELECT l.id, l.parent_id AS msoa, m.parent_id AS borough, l.geometry,
               ST_Area(l.geometry::geography) / 10000 AS hectares
        FROM area_geography l JOIN area_geography m ON m.id = l.parent_id
        WHERE l.kind = 'lsoa'
    ), trees AS (
        SELECT lsoa.id, t.common_name
        FROM lsoa JOIN street_tree t ON ST_Intersects(lsoa.geometry, t.location)
    ), levels AS (
        SELECT g.id, g.kind, ST_Area(g.geometry::geography) / 10000 AS hectares, g.geometry
        FROM area_geography g
    ), counted AS (
        SELECT level_id AS id, count(*) AS trees
        FROM (SELECT lsoa.id AS level_id FROM trees JOIN lsoa USING (id)
              UNION ALL SELECT lsoa.msoa FROM trees JOIN lsoa USING (id)
              UNION ALL SELECT lsoa.borough FROM trees JOIN lsoa USING (id)) t
        GROUP BY level_id
    ), named AS (
        SELECT level_id AS id, common_name, count(*) AS n
        FROM (SELECT lsoa.id AS level_id, trees.common_name FROM trees JOIN lsoa USING (id)
              UNION ALL SELECT lsoa.msoa, trees.common_name FROM trees JOIN lsoa USING (id)
              UNION ALL SELECT lsoa.borough, trees.common_name FROM trees JOIN lsoa USING (id)) t
        WHERE common_name IS NOT NULL AND common_name <> 'Other'  -- GLA's catch-all for unrecorded kinds
        GROUP BY level_id, common_name
    ), top AS (
        SELECT id, jsonb_agg(jsonb_build_object('name', common_name, 'count', n) ORDER BY n DESC, common_name) AS top_trees
        FROM (SELECT *, row_number() OVER (PARTITION BY id ORDER BY n DESC, common_name) AS r FROM named) ranked
        WHERE r <= 5 GROUP BY id
    )
    SELECT levels.id, green.green_share, coalesce(counted.trees, 0),
           round((coalesce(counted.trees, 0) / greatest(levels.hectares, 0.01))::numeric, 2),
           coalesce(top.top_trees, '[]'), site.name, site.kind, site.metres,
           array_remove(ARRAY[green.source_release_id,
               (SELECT source_release_id FROM street_tree LIMIT 1),
               (SELECT source_release_id FROM nature_site LIMIT 1)], NULL)
    FROM levels
    LEFT JOIN area_green green ON green.geography_id = levels.id
    LEFT JOIN counted ON counted.id = levels.id
    LEFT JOIN top ON top.id = levels.id
    LEFT JOIN LATERAL (
        SELECT s.name, s.kind, round(ST_Distance(s.geometry::geography,
               ST_PointOnSurface(levels.geometry)::geography))::integer AS metres
        FROM nature_site s
        ORDER BY s.geometry <-> ST_PointOnSurface(levels.geometry)
        LIMIT 1
    ) site ON levels.kind = 'lsoa'
    WHERE green.geography_id IS NOT NULL OR counted.id IS NOT NULL;

    WITH ranked AS (
        SELECT n.geography_id,
               CASE WHEN n.green_share IS NOT NULL
                    THEN round(100 * percent_rank() OVER (PARTITION BY area_rank_region(n.geography_id), n.green_share IS NULL ORDER BY n.green_share)) END AS green,
               round(100 * percent_rank() OVER (PARTITION BY area_rank_region(n.geography_id) ORDER BY n.trees_per_hectare)) AS trees,
               CASE WHEN n.site_metres IS NOT NULL
                    THEN round(100 * percent_rank() OVER (PARTITION BY area_rank_region(n.geography_id), n.site_metres IS NULL ORDER BY n.site_metres DESC)) END AS site,
               count(*) OVER (PARTITION BY area_rank_region(n.geography_id)) AS lsoas
        FROM area_nature n JOIN area_geography g ON g.id = n.geography_id AND g.kind = 'lsoa'
    )
    UPDATE area_nature n
    SET green_percentile = ranked.green, trees_percentile = ranked.trees,
        site_percentile = ranked.site, ranked = ranked.lsoas
    FROM ranked WHERE ranked.geography_id = n.geography_id;

    WITH scored AS (
        SELECT geography_id,
               round(100 * percent_rank() OVER (PARTITION BY area_rank_region(geography_id)
                                         ORDER BY green_percentile + trees_percentile + site_percentile)) AS score
        FROM area_nature
        WHERE green_percentile IS NOT NULL AND trees_percentile IS NOT NULL AND site_percentile IS NOT NULL
    )
    UPDATE area_nature n SET nature_percentile = scored.score
    FROM scored WHERE scored.geography_id = n.geography_id;

    SELECT count(*) INTO affected FROM area_nature;
    RETURN affected;
END;
$$;

-- from 080-uk-hpi.sql
CREATE OR REPLACE FUNCTION public.rebuild_hpi_layers(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    written integer;
BEGIN
    SELECT max(month) INTO latest FROM borough_hpi WHERE property_type = 'all';
    DELETE FROM metric_value WHERE metric_id IN ('hpi-change-5y', 'hpi-change-10y');
    IF latest IS NULL THEN
        RETURN 0;
    END IF;

    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    SELECT k.metric_id, 'lsoa', '%', 'neutral', jsonb_build_object(
               'label', 'Price change over ' || k.years || ' years',
               'shortLabel', 'Price change ' || k.years || 'y',
               'description', 'Change in the borough''s official house price index (all homes) over ' || k.years
                   || ' years to ' || to_char(latest, 'Mon YYYY') || ' (HM Land Registry UK HPI). Borough-wide.',
               'sourceId', 'hmlr-uk-hpi', 'sourceName', 'HM Land Registry UK House Price Index',
               'methodologyPath', '/guide/local-market', 'freshness', to_char(latest, 'YYYY-MM'),
               'legend', jsonb_build_array(
                   jsonb_build_object('value', k.step * -1, 'colour', '#b2182b', 'label', (k.step * -1) || '%'),
                   jsonb_build_object('value', 0, 'colour', '#f4a582', 'label', '0%'),
                   jsonb_build_object('value', k.step, 'colour', '#d1e5f0', 'label', '+' || k.step || '%'),
                   jsonb_build_object('value', k.step * 2, 'colour', '#67a9cf', 'label', '+' || k.step * 2 || '%'),
                   jsonb_build_object('value', k.step * 4, 'colour', '#2166ac', 'label', '+' || k.step * 4 || '%+')),
               'caveats', jsonb_build_array(
                   'Borough-wide: every neighbourhood in a borough shows the same figure.',
                   'The official mix-adjusted index, not our own £/m², which stays the local figure.',
                   'The latest months are first estimates and are revised as more sales are registered.',
                   'Contains HM Land Registry data © Crown copyright and database right. Licensed under the Open Government Licence v3.0.')),
           p_source_release_id
    FROM (VALUES ('hpi-change-5y', 5, 5), ('hpi-change-10y', 10, 10)) k(metric_id, years, step)
    ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition, unit = EXCLUDED.unit,
        direction = EXCLUDED.direction, carrier = EXCLUDED.carrier, source_release_id = EXCLUDED.source_release_id;

    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile,
        england_percentile, sample_count, quality, source_release_id)
    WITH changes AS (
        SELECT 'uk:borough:' || cur.borough AS borough_id, k.metric_id,
               round((100 * (cur.index / past.index - 1))::numeric, 1)::double precision AS value
        FROM (VALUES ('hpi-change-5y', 5), ('hpi-change-10y', 10)) k(metric_id, years)
        JOIN borough_hpi cur ON cur.month = latest AND cur.property_type = 'all' AND cur.borough ~ '^E0[6-9]'
        JOIN borough_hpi past ON past.borough = cur.borough AND past.property_type = 'all'
         AND past.month = (latest - make_interval(years => k.years))::date
    ), ranked AS (
        SELECT *, round(100 * percent_rank() OVER (PARTITION BY metric_id, area_rank_region(borough_id) ORDER BY value))::smallint AS pct
        FROM changes
    ), geo AS (
        SELECT g.id, g.kind,
               CASE g.kind WHEN 'borough' THEN g.id WHEN 'msoa' THEN g.parent_id ELSE m.parent_id END AS borough_id
        FROM area_geography g LEFT JOIN area_geography m ON m.id = g.parent_id
    )
    SELECT geo.id, r.metric_id, latest, r.value, r.pct, NULL, NULL,
           CASE WHEN geo.kind = 'borough' THEN 'observed' ELSE 'fallback' END::metric_quality, p_source_release_id
    FROM ranked r JOIN geo ON geo.borough_id = r.borough_id;
    GET DIAGNOSTICS written = ROW_COUNT;
    RETURN written;
END;
$$;

-- from 082-council-tax-band.sql
CREATE OR REPLACE FUNCTION public.rebuild_council_tax_band(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
    latest date;
BEGIN
    DELETE FROM area_council_tax_band t USING area_geography g WHERE g.id = t.geography_id AND g.kind <> 'lsoa';
    PERFORM roll_up_area_home('area_council_tax_band',
        ARRAY['band_a', 'band_b', 'band_c', 'band_d', 'band_e', 'band_f', 'band_g', 'band_h', 'total'],
        ARRAY['period', 'source_release_id']);
    SELECT max(period) INTO latest FROM area_council_tax_band;

    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('council-tax-band-mean', 'lsoa', 'band', 'higher-is-more', jsonb_build_object(
        'label', 'Council tax band', 'shortLabel', 'Council tax band',
        'description', 'Average council tax band of the area''s homes, A = 1 to H = 8 (VOA valuation list, '
            || to_char(latest, 'FMMonth YYYY') || '). Bands come from 1991 values, not today''s prices.',
        'legend', '[{"value": 2, "colour": "#2a6f97", "label": "B"},
                    {"value": 3, "colour": "#8ecae6", "label": "C"},
                    {"value": 4, "colour": "#f4d35e", "label": "D"},
                    {"value": 5, "colour": "#e07a1f", "label": "E"},
                    {"value": 6, "colour": "#c44536", "label": "F+"}]'::jsonb,
        'sourceId', 'voa-ctsop', 'sourceName', 'VOA Council Tax: stock of properties',
        'methodologyPath', '/guide/local-government', 'freshness', to_char(latest, 'YYYY-MM'),
        'caveats', jsonb_build_array(
            'Homes on the valuation list, rounded by VOA to the nearest 10.',
            'Bands come from 1991 values (England), not today''s prices.',
            'Areas with fewer than 50 homes show no band.',
            'VOA Council Tax: stock of properties, Open Government Licence v3.0.')),
        p_source_release_id)
    ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition, source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id = 'council-tax-band-mean';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH mean AS (
        SELECT t.geography_id, t.period, t.total,
               CASE WHEN t.total >= 50 THEN round((1 * t.band_a + 2 * t.band_b + 3 * t.band_c + 4 * t.band_d
                   + 5 * t.band_e + 6 * t.band_f + 7 * t.band_g + 8 * t.band_h)::numeric / t.total, 2)::float8 END AS value
        FROM area_council_tax_band t JOIN area_geography g ON g.id = t.geography_id AND g.kind = 'lsoa'
    ), ranked AS (
        SELECT geography_id, round(100 * percent_rank() OVER (PARTITION BY area_rank_region(geography_id) ORDER BY value))::smallint AS pct
        FROM mean WHERE value IS NOT NULL
    )
    SELECT m.geography_id, 'council-tax-band-mean', m.period, m.value, r.pct, m.total,
           CASE WHEN m.value IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality, p_source_release_id
    FROM mean m LEFT JOIN ranked r ON r.geography_id = m.geography_id;

    SELECT count(*) INTO n FROM area_council_tax_band;
    RETURN n;
END;
$$;

-- from 083-area-ownership.sql
CREATE OR REPLACE FUNCTION public.load_ownership_metrics(p_source_release_id text, p_period date)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
    caveats jsonb := jsonb_build_array(
        'Counts land titles, not homes: one title can hold a whole block, and a home can sit on more than one title.',
        'Includes commercial titles whose address looks residential.',
        'Titles are placed by the postcode in their address; titles with none are counted on the borough only.',
        'Areas with fewer than 10 homes show no share.',
        'Contains HM Land Registry data © Crown copyright and database right ' || to_char(p_period, 'YYYY') || '.');
BEGIN
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    SELECT m.id, 'lsoa', '%', 'higher-is-more', jsonb_build_object(
        'label', m.label, 'shortLabel', m.short,
        'description', m.description,
        'legend', m.legend,
        'sourceId', 'hmlr-ccod-ocod', 'sourceName', 'HM Land Registry company and overseas ownership (CCOD, OCOD)',
        'methodologyPath', '/guide/local-market', 'freshness', to_char(p_period, 'YYYY-MM'),
        'caveats', caveats), p_source_release_id
    FROM (VALUES
        ('ownership-company-share', 'Company-owned homes', 'Company owned',
         'Land titles held by UK companies (HM Land Registry CCOD) per 100 homes in the area.',
         '[{"value": 0, "colour": "#f2f0f7", "label": "0"}, {"value": 2, "colour": "#cbc9e2", "label": "2"},
           {"value": 5, "colour": "#9e9ac8", "label": "5"}, {"value": 10, "colour": "#756bb1", "label": "10"},
           {"value": 20, "colour": "#54278f", "label": "20+"}]'::jsonb),
        ('ownership-overseas-share', 'Overseas-owned homes', 'Overseas owned',
         'Land titles held by overseas companies (HM Land Registry OCOD) per 100 homes in the area.',
         '[{"value": 0, "colour": "#f2f0f7", "label": "0"}, {"value": 0.5, "colour": "#cbc9e2", "label": "0.5"},
           {"value": 1, "colour": "#9e9ac8", "label": "1"}, {"value": 2, "colour": "#756bb1", "label": "2"},
           {"value": 5, "colour": "#54278f", "label": "5+"}]'::jsonb)
    ) m(id, label, short, description, legend)
    ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition, source_release_id = EXCLUDED.source_release_id,
        unit = EXCLUDED.unit, direction = EXCLUDED.direction;

    DELETE FROM metric_value WHERE metric_id IN ('ownership-company-share', 'ownership-overseas-share');
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH shares AS (
        SELECT o.geography_id, k.metric_id, o.homes,
               CASE WHEN o.homes >= 10
                    THEN round(least(100, 100.0 * CASE k.metric_id WHEN 'ownership-company-share' THEN o.titles_company
                                                                  ELSE o.titles_overseas END / o.homes), 1)::float8
               END AS share
        FROM area_ownership o
        JOIN area_geography g ON g.id = o.geography_id AND g.kind = 'lsoa'
        CROSS JOIN (VALUES ('ownership-company-share'), ('ownership-overseas-share')) k(metric_id)
    ), ranked AS (
        SELECT geography_id, metric_id,
               round(100 * percent_rank() OVER (PARTITION BY metric_id, area_rank_region(geography_id) ORDER BY share))::smallint AS pct
        FROM shares WHERE share IS NOT NULL
    )
    SELECT s.geography_id, s.metric_id, p_period, s.share, r.pct, s.homes,
           (CASE WHEN s.share IS NULL THEN 'suppressed' ELSE 'observed' END)::metric_quality, p_source_release_id
    FROM shares s LEFT JOIN ranked r USING (geography_id, metric_id);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

-- from 086-area-mobile.sql
CREATE OR REPLACE FUNCTION public.rebuild_area_mobile_metrics(p_source_release_id text, p_period date)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
BEGIN
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    SELECT k.id, 'borough', '%', 'higher-is-better', jsonb_build_object(
            'label', k.label, 'shortLabel', k.short_label, 'description', k.description,
            'sourceId', 'ofcom-connected-nations', 'sourceName', 'Ofcom Connected Nations',
            'methodologyPath', '/guide/people-and-homes', 'freshness', to_char(p_period, 'YYYY-MM'),
            'legend', jsonb_build_array(
                jsonb_build_object('value', 90, 'colour', '#b23a48', 'label', '90%'),
                jsonb_build_object('value', 95, 'colour', '#c96a3b', 'label', '95%'),
                jsonb_build_object('value', 98, 'colour', '#f4d35e', 'label', '98%'),
                jsonb_build_object('value', 99, 'colour', '#7ba05b', 'label', '99%'),
                jsonb_build_object('value', 100, 'colour', '#3a7d44', 'label', '100%')),
            'caveats', jsonb_build_array(
                'Predicted coverage from the networks'' models, not measured speed.',
                'Published per borough only: every neighbourhood shows its borough''s figure.')),
        p_source_release_id
    FROM (VALUES
        ('mobile-4g-indoor', 'Mobile signal: 4G indoors', '4G indoors',
         'Share of the borough''s homes and offices predicted to get 4G indoors from all four networks (Ofcom).'),
        ('mobile-5g-outdoor', 'Mobile signal: 5G outdoors', '5G outdoors',
         'Share of the borough''s homes and offices predicted to get 5G outdoors from at least one network (Ofcom).')
    ) k(id, label, short_label, description)
    ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit, direction = EXCLUDED.direction,
        definition = EXCLUDED.definition, source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id IN ('mobile-4g-indoor', 'mobile-5g-outdoor');
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, england_percentile,
        sample_count, quality, source_release_id)
    SELECT m.geography_id, v.metric_id, p_period, round(100 * v.share::numeric, 2)::float8,
        round(100 * percent_rank() OVER (PARTITION BY v.metric_id, area_rank_region(m.geography_id) ORDER BY v.share))::smallint,
        NULL, m.premises, 'observed', p_source_release_id
    FROM area_mobile m
    CROSS JOIN LATERAL (VALUES ('mobile-4g-indoor', m.indoor_4g_all_mno), ('mobile-5g-outdoor', m.outdoor_5g_any))
        v(metric_id, share);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

-- from 091-air-single-rounding.sql
CREATE OR REPLACE FUNCTION public.rebuild_area_health()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_health;
    WITH lsoa AS (
        SELECT l.id AS lsoa, l.parent_id AS msoa, m.parent_id AS borough, l.geometry
        FROM area_geography l JOIN area_geography m ON m.id = l.parent_id
        WHERE l.kind = 'lsoa'
    ), levels AS (
        SELECT lsoa AS geography_id, lsoa FROM lsoa
        UNION ALL SELECT msoa, lsoa FROM lsoa
        UNION ALL SELECT borough, lsoa FROM lsoa
    ), air AS (
        SELECT v.geography_id, sum(a.no2 * a.dwellings) / sum(a.dwellings) AS no2,
               sum(a.pm25 * a.dwellings) / nullif(sum(a.dwellings) FILTER (WHERE a.pm25 IS NOT NULL), 0) AS pm25,
               max(a.year) AS year, max(a.source_release_id) AS release_id
        FROM levels v JOIN health_air_lsoa a ON a.geography_id = v.lsoa
        GROUP BY v.geography_id
    ), heat AS (
        SELECT v.geography_id,
               sum(h.heat * coalesce(a.dwellings, 1)) / sum(coalesce(a.dwellings, 1)) AS heat,
               max(h.unit) AS unit, max(h.year) AS year, max(h.source_release_id) AS release_id
        FROM levels v JOIN health_heat_lsoa h ON h.geography_id = v.lsoa
        LEFT JOIN health_air_lsoa a ON a.geography_id = v.lsoa
        GROUP BY v.geography_id
    ), centre AS (
        -- The same representative point the place and food-hygiene evidence use.
        SELECT lsoa, ST_PointOnSurface(geometry) AS point FROM lsoa
    ), gp_lsoa AS (
        SELECT c.lsoa AS geography_id,
               sum(p.patients) FILTER (WHERE p.gp_fte > 0) / nullif(sum(p.gp_fte), 0) AS per_fte,
               count(p.code) AS practices,
               (SELECT ST_Distance(n.location::geography, c.point::geography)
                FROM gp_practice n ORDER BY n.location <-> c.point LIMIT 1) AS nearest
        FROM centre c
        LEFT JOIN gp_practice p ON ST_DWithin(p.location::geography, c.point::geography, 1000)
        GROUP BY c.lsoa, c.point
    ), gp_wide AS (
        SELECT g.id AS geography_id, sum(p.patients) FILTER (WHERE p.gp_fte > 0) / nullif(sum(p.gp_fte), 0) AS per_fte,
               count(p.code) AS practices, NULL::numeric AS nearest
        FROM area_geography g LEFT JOIN gp_practice p ON ST_Contains(g.geometry, p.location)
        WHERE g.kind IN ('msoa', 'borough')
        GROUP BY g.id
    ), gp AS (
        SELECT * FROM gp_lsoa UNION ALL SELECT * FROM gp_wide
    ), gp_meta AS (
        SELECT max(month) AS month, max(source_release_id) AS release_id FROM gp_practice
    ), joined AS (
        SELECT g.id AS geography_id, g.kind, air.no2, air.pm25, air.year AS air_year, air.release_id AS air_release_id,
               heat.heat, heat.unit, heat.year AS heat_year, heat.release_id AS heat_release_id,
               CASE WHEN gp_meta.release_id IS NOT NULL THEN gp.per_fte END AS per_fte,
               CASE WHEN gp_meta.release_id IS NOT NULL THEN gp.practices END AS practices,
               CASE WHEN gp_meta.release_id IS NOT NULL THEN gp.nearest END AS nearest,
               gp_meta.month AS gp_month, gp_meta.release_id AS gp_release_id
        FROM area_geography g
        CROSS JOIN gp_meta
        LEFT JOIN air ON air.geography_id = g.id
        LEFT JOIN heat ON heat.geography_id = g.id
        LEFT JOIN gp ON gp.geography_id = g.id
    ), ranked AS (
        SELECT j.*,
               CASE WHEN no2 IS NOT NULL THEN percent_rank() OVER (PARTITION BY kind, area_rank_region(geography_id), no2 IS NULL ORDER BY no2) * 100 END AS no2_pct,
               CASE WHEN pm25 IS NOT NULL THEN percent_rank() OVER (PARTITION BY kind, area_rank_region(geography_id), pm25 IS NULL ORDER BY pm25) * 100 END AS pm25_pct,
               CASE WHEN heat IS NOT NULL THEN percent_rank() OVER (PARTITION BY kind, area_rank_region(geography_id), heat IS NULL ORDER BY heat) * 100 END AS heat_pct,
               CASE WHEN per_fte IS NOT NULL THEN percent_rank() OVER (PARTITION BY kind, area_rank_region(geography_id), per_fte IS NULL ORDER BY per_fte) * 100 END AS gp_pct
        FROM joined j
    )
    INSERT INTO area_health (geography_id, no2, pm25, air_year, no2_pct, pm25_pct, air_pct,
        heat, heat_unit, heat_year, heat_pct, gp_patients_per_fte, gp_practices, gp_nearest_m, gp_month, gp_pct,
        air_release_id, heat_release_id, gp_release_id)
    SELECT geography_id, no2, pm25, air_year, round(no2_pct::numeric, 1), round(pm25_pct::numeric, 1),
           CASE WHEN no2_pct IS NOT NULL THEN round((percent_rank() OVER (
               PARTITION BY kind, area_rank_region(geography_id), no2_pct IS NULL ORDER BY no2_pct + coalesce(pm25_pct, no2_pct)) * 100)::numeric, 1) END,
           round(heat, 2), unit, heat_year, round(heat_pct::numeric, 1),
           round(per_fte, 1), practices, round(nearest::numeric), gp_month, round(gp_pct::numeric, 1),
           air_release_id, heat_release_id, gp_release_id
    FROM ranked
    WHERE no2 IS NOT NULL OR heat IS NOT NULL OR gp_release_id IS NOT NULL;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

-- from 100-layers-v5-batch1.sql
CREATE OR REPLACE FUNCTION public.rebuild_typical_rent(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    spec record;
    added integer;
    n integer := 0;
BEGIN
    SELECT max(period) INTO latest FROM borough_rent;
    IF latest IS NULL THEN
        RAISE EXCEPTION 'borough_rent is empty: load the ONS PIPR rents first';
    END IF;
    DELETE FROM metric_value WHERE metric_id IN ('typical-rent', 'typical-rent-1-bed', 'typical-rent-3-bed');
    FOR spec IN SELECT * FROM (VALUES
        ('typical-rent', '2 bedrooms', '2-bedroom', 'Typical rent: 2 bedrooms'),
        ('typical-rent-1-bed', '1 bedroom', '1-bedroom', 'Typical rent: 1 bedroom'),
        ('typical-rent-3-bed', '3 bedrooms', '3-bedroom', 'Typical rent: 3 bedrooms')) AS s(id, bedrooms, words, label)
    LOOP
        INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
        VALUES (spec.id, 'borough', '£ a month', 'higher-is-more', jsonb_build_object(
            'label', spec.label, 'shortLabel', 'Typical rent',
            'description', 'Average monthly private rent for a ' || spec.words || ' home in the borough (mean of new '
                || 'and existing tenancies, ONS Price Index of Private Rents, ' || to_char(latest, 'FMMonth YYYY')
                || '). Borough level: every area in a borough shows the same rent. A ballpark, not the rent of any home.',
            'legend', (SELECT layer_quantile_legend(array_agg(r.monthly_rent::float8), 50, layer_ramp(), '£')
                       FROM borough_rent r JOIN area_geography g ON g.id = 'uk:borough:' || r.area_code
                       WHERE r.period = latest AND r.bedrooms = spec.bedrooms),
            'sourceId', 'ons-pipr', 'sourceName', 'ONS Price Index of Private Rents',
            'methodologyPath', '/guide/home-cost', 'freshness', to_char(latest, 'YYYY-MM'),
            'caveats', jsonb_build_array(
                'Borough-wide: every neighbourhood in a borough reads the borough''s rent.',
                'The mean rent of new and existing tenancies, not asking rents for homes on the market today.',
                'Official statistics in development: ONS may revise recent months.',
                'No City of London figures are published.',
                'Source: Office for National Statistics, Price Index of Private Rents. Open Government Licence v3.0.')),
            p_source_release_id)
        ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
            direction = EXCLUDED.direction, definition = EXCLUDED.definition,
            source_release_id = EXCLUDED.source_release_id;

        INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
            source_release_id)
        SELECT g.id, spec.id, latest, r.monthly_rent,
               round(100 * percent_rank() OVER (PARTITION BY area_rank_region(g.id) ORDER BY r.monthly_rent))::smallint, NULL, 'observed',
               p_source_release_id
        FROM borough_rent r JOIN area_geography g ON g.id = 'uk:borough:' || r.area_code AND g.kind = 'borough'
        WHERE r.period = latest AND r.bedrooms = spec.bedrooms;
        GET DIAGNOSTICS added = ROW_COUNT;
        n := n + added;
    END LOOP;
    RETURN n;
END;
$$;

-- from 100-layers-v5-batch1.sql
CREATE OR REPLACE FUNCTION public.rebuild_flood_risk(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    n integer;
BEGIN
    SELECT date_trunc('month', max(s.release_date))::date INTO latest
    FROM source_release s WHERE s.id IN (SELECT DISTINCT source_release_id FROM dwelling_flood);
    IF latest IS NULL THEN
        RAISE EXCEPTION 'dwelling_flood is empty: run rebuild_flood first';
    END IF;
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('flood-risk', 'lsoa', '%', 'higher-is-more', jsonb_build_object(
        'label', 'Homes at flood risk', 'shortLabel', 'Flood risk',
        'description', 'Share of the area''s homes in a medium or high flood-risk band (a 1% chance a year or more) '
            || 'from rivers and the sea or from surface water, read at each home''s point (Environment Agency NaFRA2, '
            || to_char(latest, 'YYYY') || ').',
        'legend', '[{"value": 0, "colour": "#3a7d44", "label": "0%"},
                    {"value": 5, "colour": "#7ba05b", "label": "5%"},
                    {"value": 15, "colour": "#f4d35e", "label": "15%"},
                    {"value": 30, "colour": "#c96a3b", "label": "30%"},
                    {"value": 50, "colour": "#b23a48", "label": "50%+"}]'::jsonb,
        'sourceId', 'ea-nafra2', 'sourceName', 'Environment Agency National Flood Risk Assessment (NaFRA2)',
        'methodologyPath', '/guide/flood', 'freshness', to_char(latest, 'YYYY-MM'),
        'caveats', jsonb_build_array(
            'Modelled chance of flooding each year, not a record of past floods.',
            'Medium is 1% to 3.3% a year, high more than 3.3%; the higher of the rivers-and-sea and surface-water bands counts.',
            'Areas with fewer than 10 homes with a point show no share.',
            'Contains public sector information licensed under the Open Government Licence v3.0. '
                || '© Environment Agency copyright and/or database right.')),
        p_source_release_id)
    ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
        direction = EXCLUDED.direction, definition = EXCLUDED.definition,
        source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id = 'flood-risk';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH homes AS (
        SELECT p.geography_id, count(*) AS homes,
               round(100 * avg((greatest(f.rivers_sea_band, f.surface_water_band) >= 3)::int), 1)::float8 AS share
        FROM dwelling_flood f JOIN property p ON p.uprn = f.uprn
        GROUP BY p.geography_id
    ), shares AS (
        SELECT g.id, coalesce(h.homes, 0) AS homes, CASE WHEN h.homes >= 10 THEN h.share END AS share
        FROM area_geography g LEFT JOIN homes h ON h.geography_id = g.id
        WHERE g.kind = 'lsoa'
    ), ranked AS (
        SELECT id, round(100 * percent_rank() OVER (PARTITION BY area_rank_region(id) ORDER BY share))::smallint AS pct
        FROM shares WHERE share IS NOT NULL
    )
    SELECT s.id, 'flood-risk', latest, s.share, r.pct, s.homes,
           CASE WHEN s.share IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality, p_source_release_id
    FROM shares s LEFT JOIN ranked r ON r.id = s.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

-- from 100-layers-v5-batch1.sql
CREATE OR REPLACE FUNCTION public.rebuild_good_schools_nearby(p_source_release_id text,
    p_radius_m double precision DEFAULT 1500, p_top_percent integer DEFAULT 25)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    spec record;
    year text;
    period date;
    added integer;
    n integer := 0;
    active boolean := EXISTS (SELECT 1 FROM active_product_release);
BEGIN
    DELETE FROM metric_value WHERE metric_id IN ('good-schools-nearby', 'good-schools-nearby-secondary');
    FOR spec IN SELECT * FROM (VALUES
        ('good-schools-nearby', 'primary', 'Good primary schools within 1.5 km', 'primaries',
         'KS2 reading, writing and maths at the expected standard'),
        ('good-schools-nearby-secondary', 'secondary', 'Good secondary schools within 1.5 km', 'secondaries',
         'KS4 Attainment 8')) AS s(id, phase, label, plural, measure)
    LOOP
        SELECT max(r.academic_year) INTO year FROM school_national_rank r
        WHERE r.phase = spec.phase AND (NOT active OR r.source_release_id IN (
            SELECT m.source_release_id FROM product_release_member m
            WHERE m.release_id = (SELECT release_id FROM active_product_release)));
        IF year IS NULL THEN
            RAISE EXCEPTION 'no % England ranks in school_national_rank: run etl_school_performance.py first', spec.phase;
        END IF;
        period := make_date(left(year, 4)::int + 1, 7, 1);  -- 2024/25: July 2025, the end of the year

        INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
        VALUES (spec.id, 'lsoa', 'schools', 'higher-is-better', jsonb_build_object(
            'label', spec.label, 'shortLabel', 'Good schools nearby',
            'description', 'Open state ' || spec.phase || ' schools within 1.5 km of the area''s centre that rank in '
                || 'England''s top 25% (' || spec.measure || ', ' || year || ').',
            'legend', '[{"value": 0, "colour": "#c7e9b4", "label": "0"},
                        {"value": 1, "colour": "#7fcdbb", "label": "1"},
                        {"value": 2, "colour": "#1d91c0", "label": "2"},
                        {"value": 4, "colour": "#253494", "label": "4"},
                        {"value": 6, "colour": "#081d58", "label": "6+"}]'::jsonb,
            'sourceId', 'dfe-performance', 'sourceName', 'DfE school performance tables',
            'methodologyPath', '/guide/schools', 'freshness', year,
            'caveats', jsonb_build_array(
                'Straight-line distance from a point inside the area, not walking distance or a catchment.',
                'England rank on one measure in the latest published year; schools with a suppressed figure are not ranked.',
                'Only London state schools are counted, so areas near London''s edge may read low.',
                'A school nearby is not a place offered: admissions follow each school''s own rules.',
                'Department for Education school performance data and Get Information about Schools. '
                    || 'Open Government Licence v3.0.')),
            p_source_release_id)
        ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
            direction = EXCLUDED.direction, definition = EXCLUDED.definition,
            source_release_id = EXCLUDED.source_release_id;

        INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
            source_release_id)
        WITH good AS (
            -- The ranks of the active product release only (as the map's Show › Schools reads them).
            SELECT s.location FROM school s JOIN school_national_rank r ON r.urn = s.urn
            WHERE r.phase = spec.phase AND r.academic_year = year AND r.top_percent <= p_top_percent
              AND s.successor_urn IS NULL
              AND (NOT active OR r.source_release_id IN (
                  SELECT m.source_release_id FROM product_release_member m
                  WHERE m.release_id = (SELECT release_id FROM active_product_release)))
        ), counted AS (
            SELECT l.id, (SELECT count(*) FROM good
                          WHERE ST_DWithin(good.location::geography, ST_PointOnSurface(l.geometry)::geography,
                                           p_radius_m))::int AS schools
            FROM area_geography l WHERE l.kind = 'lsoa'
        )
        SELECT id, spec.id, period, schools, round(100 * percent_rank() OVER (PARTITION BY area_rank_region(id) ORDER BY schools))::smallint, NULL,
               'observed', p_source_release_id
        FROM counted;
        GET DIAGNOSTICS added = ROW_COUNT;
        n := n + added;
    END LOOP;
    RETURN n;
END;
$$;

-- from 101-layers-v5-batch2.sql
CREATE OR REPLACE FUNCTION public.rebuild_supermarket_walk(p_source_release_id text,
    p_max_metres double precision DEFAULT 5000, p_min_confidence real DEFAULT 0.6)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    n integer;
BEGIN
    SELECT date_trunc('month', max(s.release_date))::date INTO latest
    FROM source_release s WHERE s.id IN (
        SELECT DISTINCT source_release_id FROM place WHERE tags @> '{"shop": "supermarket"}');
    IF latest IS NULL THEN
        RAISE EXCEPTION 'no supermarkets in place: load the merged places first';
    END IF;
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('supermarket-walk', 'lsoa', 'minutes', 'higher-is-more', jsonb_build_object(
        'label', 'Walk to a supermarket', 'shortLabel', 'Supermarket',
        'description', 'Walking minutes from a point inside the area to the nearest supermarket on OpenStreetMap '
            || '(shop=supermarket, ' || to_char(latest, 'FMMonth YYYY') || '), along a straight line at 4.8 km/h '
            || 'with a 1.3 detour factor, as the nearest-place criteria estimate a walk.',
        'legend', layer_walk_legend(),
        'sourceId', 'osm', 'sourceName', 'OpenStreetMap',
        'methodologyPath', '/guide/getting-around', 'freshness', to_char(latest, 'YYYY-MM'),
        'caveats', jsonb_build_array(
            'A straight-line estimate, not a walking route.',
            'Large and small supermarkets count alike; corner shops (shop=convenience) do not.',
            'OpenStreetMap is kept by volunteers: a new shop may be missing and a closed one still listed.',
            'Areas with no supermarket within 5 km show no figure.',
            '© OpenStreetMap contributors. Open Database Licence (ODbL) 1.0.')),
        p_source_release_id)
    ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
        direction = EXCLUDED.direction, definition = EXCLUDED.definition,
        source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id = 'supermarket-walk';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH area AS (
        SELECT id, ST_PointOnSurface(geometry) AS point FROM area_geography WHERE kind = 'lsoa'
    ), near AS (
        SELECT a.id, (SELECT ST_Distance(p.location::geography, a.point::geography) FROM place p
                      WHERE p.tags @> '{"shop": "supermarket"}' AND p.confidence >= p_min_confidence
                      ORDER BY p.location <-> a.point LIMIT 1) AS metres
        FROM area a
    ), walks AS (
        SELECT id, CASE WHEN metres <= p_max_metres THEN layer_walk_minutes(metres) END AS minutes FROM near
    ), ranked AS (
        SELECT id, round(100 * percent_rank() OVER (PARTITION BY area_rank_region(id) ORDER BY minutes))::smallint AS pct FROM walks
        WHERE minutes IS NOT NULL
    )
    SELECT w.id, 'supermarket-walk', latest, w.minutes, r.pct, NULL,
           CASE WHEN w.minutes IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality, p_source_release_id
    FROM walks w LEFT JOIN ranked r ON r.id = w.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

-- from 101-layers-v5-batch2.sql
CREATE OR REPLACE FUNCTION public.rebuild_gp_walk(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    n integer;
BEGIN
    SELECT max(gp_month) INTO latest FROM area_health WHERE gp_nearest_m IS NOT NULL;
    IF latest IS NULL THEN
        RAISE EXCEPTION 'no nearest GP in area_health: run etl_health.py load-gp first';
    END IF;
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('gp-walk', 'lsoa', 'minutes', 'higher-is-more', jsonb_build_object(
        'label', 'Walk to a GP', 'shortLabel', 'GP',
        'description', 'Walking minutes from a point inside the area to the nearest GP practice (NHS England, '
            || 'Patients Registered at a GP Practice, ' || to_char(latest, 'FMMonth YYYY') || '), along a straight '
            || 'line at 4.8 km/h with a 1.3 detour factor.',
        'legend', layer_walk_legend(),
        'sourceId', 'nhs-gp-practices', 'sourceName', 'NHS England, Patients Registered at a GP Practice',
        'methodologyPath', '/guide/getting-around', 'freshness', to_char(latest, 'YYYY-MM'),
        'caveats', jsonb_build_array(
            'A straight-line estimate, not a walking route.',
            'Each practice sits at its postcode''s centre; branch surgeries are not listed separately.',
            'Being near a practice is not registration: each practice sets its own catchment.',
            'Contains information from NHS England, licensed under the current version of the Open Government Licence.')),
        p_source_release_id)
    ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
        direction = EXCLUDED.direction, definition = EXCLUDED.definition,
        source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id = 'gp-walk';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH walks AS (
        SELECT g.id, layer_walk_minutes(h.gp_nearest_m::float8) AS minutes
        FROM area_geography g LEFT JOIN area_health h ON h.geography_id = g.id
        WHERE g.kind = 'lsoa'
    ), ranked AS (
        SELECT id, round(100 * percent_rank() OVER (PARTITION BY area_rank_region(id) ORDER BY minutes))::smallint AS pct FROM walks
        WHERE minutes IS NOT NULL
    )
    SELECT w.id, 'gp-walk', latest, w.minutes, r.pct, NULL,
           CASE WHEN w.minutes IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality, p_source_release_id
    FROM walks w LEFT JOIN ranked r ON r.id = w.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

-- from 101-layers-v5-batch2.sql
CREATE OR REPLACE FUNCTION public.rebuild_broadband_gigabit(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    n integer;
BEGIN
    SELECT date_trunc('month', max(s.release_date))::date INTO latest
    FROM source_release s WHERE s.id IN (SELECT DISTINCT source_release_id FROM area_broadband);
    IF latest IS NULL THEN
        RAISE EXCEPTION 'area_broadband is empty: run etl_home.py (broadband) first';
    END IF;
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('broadband-gigabit', 'lsoa', '%', 'higher-is-better', jsonb_build_object(
        'label', 'Gigabit broadband', 'shortLabel', 'Broadband',
        'description', 'Share of the area''s premises where a gigabit-capable line (1,000 Mbit/s) can be ordered '
            || '(Ofcom Connected Nations, ' || to_char(latest, 'FMMonth YYYY') || ').',
        'legend', '[{"value": 0, "colour": "#c7e9b4", "label": "0%"},
                    {"value": 50, "colour": "#7fcdbb", "label": "50%"},
                    {"value": 75, "colour": "#1d91c0", "label": "75%"},
                    {"value": 90, "colour": "#253494", "label": "90%"},
                    {"value": 95, "colour": "#081d58", "label": "95%+"}]'::jsonb,
        'sourceId', 'ofcom-connected-nations', 'sourceName', 'Ofcom Connected Nations',
        'methodologyPath', '/guide/people-and-homes', 'freshness', to_char(latest, 'YYYY-MM'),
        'caveats', jsonb_build_array(
            'Availability, not take-up: a line can be ordered, not that a home has it.',
            'Residential output areas summed to neighbourhoods.',
            'Areas with fewer than 10 premises show no share.',
            'Contains Ofcom data licensed under the Open Government Licence v3.0.')),
        p_source_release_id)
    ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
        direction = EXCLUDED.direction, definition = EXCLUDED.definition,
        source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id = 'broadband-gigabit';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH shares AS (
        SELECT g.id, coalesce(b.premises, 0) AS premises,
               CASE WHEN b.premises >= 10 THEN round(least(100.0, 100.0 * b.gigabit_premises / b.premises), 1)::float8 END AS share
        FROM area_geography g LEFT JOIN area_broadband b ON b.geography_id = g.id
        WHERE g.kind = 'lsoa'
    ), ranked AS (
        SELECT id, round(100 * percent_rank() OVER (PARTITION BY area_rank_region(id) ORDER BY share))::smallint AS pct
        FROM shares WHERE share IS NOT NULL
    )
    SELECT s.id, 'broadband-gigabit', latest, s.share, r.pct, s.premises,
           CASE WHEN s.share IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality, p_source_release_id
    FROM shares s LEFT JOIN ranked r ON r.id = s.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

SELECT refresh_area_region();
