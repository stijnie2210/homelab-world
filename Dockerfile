FROM golang:1-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
COPY web ./web
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /homelab-world .

FROM scratch
COPY --from=build /homelab-world /homelab-world
EXPOSE 8099
ENTRYPOINT ["/homelab-world"]
