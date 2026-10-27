# Offline commute job (ETL machine only): r5py drives the pinned R5 engine on Java 21.
# Production never runs this image; it only serves the rows the job loads into Postgres.
FROM python:3.12-slim-trixie
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-21-jre-headless libexpat1 \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir r5py==1.1.7 pandas==2.2.3 geopandas==1.0.1 shapely==2.0.7 pyarrow==19.0.1
WORKDIR /work
ENTRYPOINT ["python", "/app/commute_r5.py"]
