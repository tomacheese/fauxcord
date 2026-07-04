# syntax=docker/dockerfile:1
# Build context is compat/ (see docker-compose.yml), so COPY paths are prefixed
# with the library directory and the shared common/ dir.
#
# Single-stage: build and run from the SDK image (matches the low-ceremony
# style of the JS/Go/Python verifiers rather than a multi-stage build+publish).
FROM mcr.microsoft.com/dotnet/sdk:8.0
WORKDIR /app
COPY dotnet-discordnet/DiscordNetVerify.csproj ./
RUN dotnet restore
COPY dotnet-discordnet/Program.cs ./
COPY common ./common
CMD ["dotnet", "run", "--project", ".", "--no-restore"]
