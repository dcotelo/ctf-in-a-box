# Injected into the vulnerableapp fork's root by `ctf-setup org` — vanilla
# SasanLabs/VulnerableApp@2.1.37 ships no root Dockerfile, and the scorer builds
# the app from the PR checkout.
FROM eclipse-temurin:17-jdk AS build
WORKDIR /src
COPY . .
RUN ./gradlew --no-daemon -x test -x spotlessCheck -x spotlessJavaCheck clean bootJar

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /src/build/libs/VulnerableApp-*.jar /app/app.jar
EXPOSE 9090
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
