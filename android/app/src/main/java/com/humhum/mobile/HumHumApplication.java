package com.humhum.mobile;

import android.app.Application;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import com.humhum.mobile.health.HealthForegroundRefresh;

public final class HumHumApplication extends Application {
    private static volatile boolean fcmConfigured;

    @Override public void onCreate() {
        super.onCreate();
        HealthForegroundRefresh.INSTANCE.register(this);
        PushConfig config;
        try {
            config = PushConfig.fromBuildValues(
                    BuildConfig.FIREBASE_APPLICATION_ID,
                    BuildConfig.FIREBASE_API_KEY,
                    BuildConfig.FIREBASE_PROJECT_ID,
                    BuildConfig.FIREBASE_SENDER_ID);
        } catch (IllegalArgumentException error) {
            return;
        }
        if (config == null) return;
        try {
            FirebaseOptions options = new FirebaseOptions.Builder()
                    .setApplicationId(config.applicationId())
                    .setApiKey(config.apiKey())
                    .setProjectId(config.projectId())
                    .setGcmSenderId(config.senderId())
                    .build();
            FirebaseApp app;
            try {
                app = FirebaseApp.getInstance();
            } catch (IllegalStateException missing) {
                app = FirebaseApp.initializeApp(this, options);
            }
            if (app == null) return;
            app.setDataCollectionDefaultEnabled(false);
            fcmConfigured = true;
            FirebaseMessaging.getInstance().setAutoInitEnabled(true);
            PushRegistration.refresh(this);
        } catch (RuntimeException error) {
            fcmConfigured = false;
        }
    }

    static boolean isFcmConfigured() {
        return fcmConfigured;
    }
}
