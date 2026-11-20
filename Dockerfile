FROM --platform=$BUILDPLATFORM golang:1-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod ./
COPY *.go ./
COPY web ./web
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /homelab-world .

FROM scratch
COPY --from=build /homelab-world /homelab-world
USER 65534:65534
EXPOSE 8099
ENTRYPOINT ["/homelab-world"]
