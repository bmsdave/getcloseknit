-- Migration 001 enforces the borough > MSOA > LSOA hierarchy, so the smoke
-- LSOA needs its parents.
INSERT INTO area_geography (id, kind, official_code, name, geometry)
VALUES ('uk:lad:E09000033', 'lad', 'E09000033', 'Deployment smoke borough', ST_Multi(ST_GeomFromText(
        'POLYGON((-0.168 51.493,-0.118 51.493,-0.118 51.528,-0.168 51.528,-0.168 51.493))',
        4326
    )));
INSERT INTO area_geography (id, kind, official_code, name, parent_id, geometry)
VALUES ('uk:msoa:E02000001', 'msoa', 'E02000001', 'Deployment smoke MSOA', 'uk:lad:E09000033', ST_Multi(ST_GeomFromText(
        'POLYGON((-0.168 51.493,-0.118 51.493,-0.118 51.528,-0.168 51.528,-0.168 51.493))',
        4326
    )));
INSERT INTO area_geography (id, kind, official_code, name, parent_id, geometry)
VALUES (
    'uk:lsoa:E01000001',
    'lsoa',
    'E01000001',
    'Deployment smoke test',
    'uk:msoa:E02000001',
    ST_Multi(ST_GeomFromText(
        'POLYGON((-0.168 51.493,-0.118 51.493,-0.118 51.528,-0.168 51.528,-0.168 51.493))',
        4326
    ))
);
